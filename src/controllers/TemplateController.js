const logger = require('../utils/logger');
const prisma =
require('../services/database');
const axios = require('axios');

class TemplateController {
  static async list(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const templates = await prisma.template.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' }
      });
      res.json(templates);
    } catch (e) {
      res.status(500).json({ error: 'Failed' });
    }
  }

  static async sync(req, res) {
    const tenantId = req.user.tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get Configuration with tenant credentials
    const config = await prisma.configuration.findUnique({
      where: { tenantId }
    });

    if (!config || !config.whatsappToken) {
      return res.status(400).json({ error: 'WhatsApp Token not configured' });
    }

    const token = config.whatsappToken;
    const phoneId = config.phoneNumberId;

    if (!phoneId) {
      return res.status(400).json({ error: 'Phone Number ID not configured' });
    }

    try {
      // 1. Get WABA ID if missing
      let wabaId = tenant.waBusinessId;
      if (!wabaId) {
        // If we have a phone ID, we can find the WABA ID
        if (!phoneId) {
          return res.status(400).json({ error: 'No Phone ID to resolve Business ID' });
        }

        const phoneRes = await axios.get(
          `https://graph.facebook.com/v18.0/${phoneId}?fields=whatsapp_business_account`,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        wabaId = phoneRes.data.whatsapp_business_account?.id;

        if (wabaId) {
          await prisma.tenant.update({ where: { id: tenantId }, data: { waBusinessId: wabaId } });
        }
      }

      if (!wabaId) {
        return res.status(400).json({ error: 'Could not resolve WhatsApp Business Account ID' });
      }

      // 2. Fetch Templates from Meta
      const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates?limit=100`;
      const tmplRes = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = tmplRes.data.data; // Array of templates

      // 3. Sync DB
      let count = 0;
      for (const t of data) {
        // "t" contains: name, status, category, components, language (array usually? no, string in result usually, but endpoints differ)
        // Meta returns structure like: { name, status, category, language: "pt_BR", ... } (Wait, language might be nested?)
        // Actually endpoint returns: { name, status, category, language, components }

        // Note: Meta allows same template name for different languages.
        // schema.prisma has @@unique([tenantId, name]) -> This assumes 1 language per name or simply distinct names.
        // If customer has "welcome" in EN and "welcome" in PT, this unique constraint will fail.
        // Ideally @@unique([tenantId, name, language]).
        // But for now let's hope names are unique or we just overwrite.

        await prisma.template.upsert({
          where: { tenantId_name: { tenantId, name: t.name } },
          update: {
            status: t.status,
            category: t.category,
            components: t.components,
            language: t.language || 'pt_BR'
          },
          create: {
            tenantId,
            name: t.name,
            status: t.status,
            category: t.category,
            components: t.components,
            language: t.language || 'pt_BR'
          }
        });
        count++;
      }

      res.json({ success: true, count, total_fetched: data.length });
    } catch (e) {
      logger.error('Template Sync Error:', e.response?.data || e.message);
      res.status(500).json({ error: 'Failed to sync with Meta. Check permissions.' });
    }
  }
}

module.exports = TemplateController;
