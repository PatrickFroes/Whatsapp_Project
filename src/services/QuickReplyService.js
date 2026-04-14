/**
 * QuickReplyService - Respostas rápidas (Canned Responses)
 */

const prisma = require('./database');

class QuickReplyService {
  /**
   * Lista todas as quick replies do tenant
   */
  static async list(tenantId, filters = {}) {
    const { category, isActive, search } = filters;

    const where = { tenantId };

    if (category) {
      where.category = category;
    }
    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
        { shortcut: { contains: search, mode: 'insensitive' } }
      ];
    }

    return await prisma.quickReply.findMany({
      where,
      orderBy: [{ useCount: 'desc' }, { title: 'asc' }]
    });
  }

  /**
   * Busca quick reply por shortcut
   */
  static async findByShortcut(tenantId, shortcut) {
    return await prisma.quickReply.findUnique({
      where: {
        tenantId_shortcut: { tenantId, shortcut }
      }
    });
  }

  /**
   * Cria nova quick reply
   */
  static async create(tenantId, data) {
    const { title, shortcut, content, category } = data;

    // Validar shortcut único
    const existing = await this.findByShortcut(tenantId, shortcut);
    if (existing) {
      throw new Error('Shortcut already exists');
    }

    return await prisma.quickReply.create({
      data: {
        tenantId,
        title,
        shortcut,
        content,
        category: category || 'General'
      }
    });
  }

  /**
   * Atualiza quick reply
   */
  static async update(id, tenantId, data) {
    const quickReply = await prisma.quickReply.findFirst({
      where: { id, tenantId }
    });

    if (!quickReply) {
      throw new Error('Quick reply not found');
    }

    // Whitelist de campos permitidos
    const { title, shortcut, content, category } = data;
    const safeData = {};
    if (title !== undefined) {
      safeData.title = title;
    }
    if (shortcut !== undefined) {
      safeData.shortcut = shortcut;
    }
    if (content !== undefined) {
      safeData.content = content;
    }
    if (category !== undefined) {
      safeData.category = category;
    }

    return await prisma.quickReply.update({
      where: { id },
      data: safeData
    });
  }

  /**
   * Deleta quick reply
   */
  static async delete(id, tenantId) {
    const quickReply = await prisma.quickReply.findFirst({
      where: { id, tenantId }
    });

    if (!quickReply) {
      throw new Error('Quick reply not found');
    }

    return await prisma.quickReply.delete({
      where: { id }
    });
  }

  /**
   * Incrementa contador de uso
   */
  static async incrementUseCount(id) {
    return await prisma.quickReply.update({
      where: { id },
      data: {
        useCount: {
          increment: 1
        }
      }
    });
  }

  /**
   * Processa variáveis no conteúdo
   * Exemplo: "Olá {{name}}, seu pedido {{orderId}} está pronto!"
   */
  static processVariables(content, variables = {}) {
    let processed = content;

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processed = processed.replace(regex, value);
    }

    return processed;
  }

  /**
   * Busca e processa quick reply por shortcut
   */
  static async getProcessed(tenantId, shortcut, variables = {}) {
    const quickReply = await this.findByShortcut(tenantId, shortcut);

    if (!quickReply || !quickReply.isActive) {
      throw new Error('Quick reply not found or inactive');
    }

    // Incrementar uso
    await this.incrementUseCount(quickReply.id);

    // Processar variáveis
    const content = this.processVariables(quickReply.content, variables);

    return {
      ...quickReply,
      content
    };
  }

  /**
   * Lista categorias do tenant
   */
  static async listCategories(tenantId) {
    const replies = await prisma.quickReply.findMany({
      where: { tenantId },
      select: { category: true },
      distinct: ['category']
    });

    return replies
      .map((r) => r.category)
      .filter(Boolean)
      .sort();
  }
}

module.exports = QuickReplyService;
