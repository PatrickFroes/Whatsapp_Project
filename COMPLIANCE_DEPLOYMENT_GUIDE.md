# 🚀 GUIA DE PUBLICAÇÃO - DOCUMENTOS DE CONFORMIDADE

**Como Deploy Documentos Legais na Produção**  
**Data**: 17 de abril de 2026  
**Versão**: 1.0

---

## 📋 RESUMO

Este guia explica como publicar os 5 documentos de conformidade gerados na plataforma Broker:

1. **TERMS_OF_SERVICE.md** → `/termos-de-servico`
2. **PROJECT_ANALYSIS_REPORT.md** → `/admin/reports/analysis`
3. **COMPLIANCE_AND_DATA_HANDLING_GUIDE.md** → `/admin/compliance/guide`
4. **COMPLIANCE_CHECKLIST.md** → `/admin/compliance/checklist`
5. **COMPLIANCE_DOCUMENTATION_INDEX.md** → `/admin/compliance/index`

---

## 1. PUBLICAR TERMOS DE SERVIÇO

### 1.1 Criar Página HTML

**Arquivo**: `frontend/terms.html`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Termos de Serviço - Broker</title>
    <link rel="stylesheet" href="/css/global.css">
    <link rel="stylesheet" href="/css/legal.css">
</head>
<body>
    <div class="container legal-page">
        <header>
            <nav>
                <a href="/">Início</a>
            </nav>
        </header>
        
        <main id="terms-content">
            <!-- Markdown será convertido para HTML aqui -->
        </main>
        
        <footer>
            <p>&copy; 2026 Broker SaaS. Todos os direitos reservados.</p>
            <ul>
                <li><a href="/privacidade">Política de Privacidade</a></li>
                <li><a href="/termos-de-servico">Termos de Serviço</a></li>
                <li><a href="/compliance">Conformidade</a></li>
            </ul>
        </footer>
    </div>
    
    <script src="/js/markdown-converter.js"></script>
    <script>
        // Converter Markdown para HTML
        fetch('/api/content/terms')
            .then(res => res.json())
            .then(data => {
                document.getElementById('terms-content').innerHTML = 
                    markdownToHtml(data.content);
            });
    </script>
</body>
</html>
```

### 1.2 Criar Endpoint API

**Arquivo**: `src/routes/publicRoutes.js`

```javascript
// GET /api/content/terms - Retorna Termos de Serviço
router.get('/content/terms', (req, res) => {
    const termsPath = path.join(__dirname, '../../TERMS_OF_SERVICE.md');
    
    fs.readFile(termsPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(404).json({ 
                error: 'Terms not found',
                message: 'Os termos de serviço não estão disponíveis' 
            });
        }
        
        res.json({
            content: data,
            version: '1.0',
            lastUpdated: '2026-04-17',
            status: 'published'
        });
    });
});

// GET /api/content/privacy - Retorna Política de Privacidade
router.get('/content/privacy', (req, res) => {
    const privacyPath = path.join(__dirname, '../../frontend/privacy.html');
    
    fs.readFile(privacyPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(404).json({ error: 'Privacy policy not found' });
        }
        
        res.json({
            content: data,
            format: 'html',
            version: '1.0'
        });
    });
});
```

### 1.3 Criar Rota de Renderização

**Arquivo**: `src/routes/pageRoutes.js`

```javascript
// GET /termos-de-servico - Renderiza página
router.get('/termos-de-servico', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/terms.html'));
});

// GET /privacidade - Renderiza página de privacidade
router.get('/privacidade', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/privacy.html'));
});

// GET /compliance - Página de conformidade (auth required)
router.get('/compliance', authMiddleware, requiredRole('ADMIN', 'OWNER', 'SUPER_ADMIN'), 
    (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/compliance.html'));
});
```

### 1.4 CSS Para Página Legal

**Arquivo**: `frontend/css/legal.css`

```css
.legal-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 20px;
}

.legal-page header {
    margin-bottom: 40px;
    border-bottom: 1px solid #eee;
    padding-bottom: 20px;
}

.legal-page main {
    line-height: 1.8;
    color: #333;
    font-size: 16px;
}

.legal-page main h1 {
    font-size: 32px;
    color: #000;
    margin: 30px 0 20px 0;
}

.legal-page main h2 {
    font-size: 24px;
    color: #1a1a1a;
    margin: 25px 0 15px 0;
    border-left: 4px solid #007bff;
    padding-left: 15px;
}

.legal-page main h3 {
    font-size: 18px;
    color: #333;
    margin: 20px 0 10px 0;
}

.legal-page main ul, 
.legal-page main ol {
    margin: 15px 0 15px 20px;
}

.legal-page main li {
    margin: 8px 0;
}

.legal-page main table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    border: 1px solid #ddd;
}

.legal-page main table th,
.legal-page main table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #ddd;
}

.legal-page main table th {
    background-color: #f8f9fa;
    font-weight: 600;
    color: #333;
}

.legal-page main code {
    background: #f4f4f4;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
}

.legal-page main pre {
    background: #f8f8f8;
    padding: 15px;
    border-radius: 5px;
    overflow-x: auto;
    border-left: 4px solid #007bff;
}

.legal-page main blockquote {
    border-left: 4px solid #007bff;
    padding-left: 15px;
    margin-left: 0;
    color: #666;
}

.legal-page footer {
    margin-top: 60px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    color: #666;
    font-size: 14px;
}

.legal-page footer ul {
    list-style: none;
    margin: 15px 0;
    padding: 0;
}

.legal-page footer li {
    display: inline;
    margin-right: 20px;
}

.legal-page footer a {
    color: #007bff;
    text-decoration: none;
}

.legal-page footer a:hover {
    text-decoration: underline;
}

/* Responsive */
@media (max-width: 768px) {
    .legal-page {
        padding: 20px 15px;
    }
    
    .legal-page main h1 {
        font-size: 24px;
    }
    
    .legal-page main h2 {
        font-size: 20px;
    }
    
    .legal-page main table {
        font-size: 14px;
    }
    
    .legal-page main table th,
    .legal-page main table td {
        padding: 8px;
    }
}
```

---

## 2. PUBLICAR DOCUMENTOS ADMIN (Interno)

### 2.1 Criar Página Admin

**Arquivo**: `frontend/admin/compliance.html`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Compliance - Admin Broker</title>
    <link rel="stylesheet" href="/css/admin-global.css">
    <style>
        .compliance-section {
            margin: 20px 0;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        
        .doc-link {
            display: inline-block;
            margin: 5px;
            padding: 10px 15px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 3px;
        }
        
        .doc-link:hover {
            background: #0056b3;
        }
        
        .status {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
        }
        
        .status.published {
            background: #d4edda;
            color: #155724;
        }
        
        .status.draft {
            background: #fff3cd;
            color: #856404;
        }
    </style>
</head>
<body>
    <div class="admin-container">
        <h1>📋 Centro de Conformidade</h1>
        
        <div class="compliance-section">
            <h2>Documentos de Conformidade</h2>
            <table>
                <tr>
                    <th>Documento</th>
                    <th>Status</th>
                    <th>Ação</th>
                </tr>
                <tr>
                    <td>Termos de Serviço</td>
                    <td><span class="status published">Publicado</span></td>
                    <td>
                        <a href="/api/admin/compliance/download/terms" class="doc-link">Download</a>
                        <a href="/termos-de-servico" class="doc-link">Ver</a>
                    </td>
                </tr>
                <tr>
                    <td>Política de Privacidade</td>
                    <td><span class="status published">Publicado</span></td>
                    <td>
                        <a href="/api/admin/compliance/download/privacy" class="doc-link">Download</a>
                        <a href="/privacidade" class="doc-link">Ver</a>
                    </td>
                </tr>
                <tr>
                    <td>Guia de Conformidade</td>
                    <td><span class="status published">Publicado</span></td>
                    <td>
                        <a href="/api/admin/compliance/download/guide" class="doc-link">Download</a>
                        <a href="/admin/compliance/guide" class="doc-link">Ver</a>
                    </td>
                </tr>
                <tr>
                    <td>Relatório de Análise</td>
                    <td><span class="status published">Publicado</span></td>
                    <td>
                        <a href="/api/admin/compliance/download/analysis" class="doc-link">Download</a>
                        <a href="/admin/compliance/analysis" class="doc-link">Ver</a>
                    </td>
                </tr>
                <tr>
                    <td>Checklist</td>
                    <td><span class="status published">Publicado</span></td>
                    <td>
                        <a href="/api/admin/compliance/download/checklist" class="doc-link">Download</a>
                        <a href="/admin/compliance/checklist" class="doc-link">Ver</a>
                    </td>
                </tr>
            </table>
        </div>
        
        <div class="compliance-section">
            <h2>Dashboard de Conformidade</h2>
            <p id="compliance-status">Carregando...</p>
        </div>
    </div>
    
    <script>
        // Carregar status de conformidade
        fetch('/api/admin/compliance/status')
            .then(res => res.json())
            .then(data => {
                const status = document.getElementById('compliance-status');
                status.innerHTML = `
                    <p>LGPD: ${data.lgpd}%</p>
                    <p>GDPR: ${data.gdpr}%</p>
                    <p>WhatsApp: ${data.whatsapp}%</p>
                    <p>Overall: ${data.overall}%</p>
                `;
            });
    </script>
</body>
</html>
```

### 2.2 Criar Endpoints de Download

**Arquivo**: `src/routes/adminRoutes.js`

```javascript
// GET /api/admin/compliance/download/:docType
router.get('/compliance/download/:docType', 
    authMiddleware, 
    requiredRole('ADMIN', 'OWNER', 'SUPER_ADMIN'),
    (req, res) => {
    
    const { docType } = req.params;
    
    const docMap = {
        'terms': 'TERMS_OF_SERVICE.md',
        'privacy': 'frontend/privacy.html',
        'guide': 'COMPLIANCE_AND_DATA_HANDLING_GUIDE.md',
        'analysis': 'PROJECT_ANALYSIS_REPORT.md',
        'checklist': 'COMPLIANCE_CHECKLIST.md'
    };
    
    const docPath = docMap[docType];
    
    if (!docPath) {
        return res.status(404).json({ error: 'Document not found' });
    }
    
    const fullPath = path.join(__dirname, '../../', docPath);
    
    // Log para auditoria
    logger.info('COMPLIANCE_DOWNLOAD', {
        user: req.user.id,
        tenant: req.user.tenantId,
        document: docType,
        timestamp: new Date()
    });
    
    res.download(fullPath, `${docType}.${docPath.split('.').pop()}`);
});

// GET /api/admin/compliance/status - Status geral
router.get('/compliance/status', 
    authMiddleware,
    requiredRole('ADMIN', 'OWNER', 'SUPER_ADMIN'),
    (req, res) => {
    
    const status = {
        lgpd: 95,          // % completo
        gdpr: 95,
        whatsapp: 90,
        security: 85,
        overall: 91,
        lastAudit: '2026-04-17',
        nextAudit: '2026-07-17'
    };
    
    res.json(status);
});
```

---

## 3. ADICIONAR LINKS NO FOOTER

**Arquivo**: `frontend/components/footer.html`

```html
<footer class="main-footer">
    <div class="footer-content">
        <div class="footer-section">
            <h4>Sobre</h4>
            <ul>
                <li><a href="/">Início</a></li>
                <li><a href="/blog">Blog</a></li>
                <li><a href="/contato">Contato</a></li>
            </ul>
        </div>
        
        <div class="footer-section">
            <h4>Suporte</h4>
            <ul>
                <li><a href="/docs">Documentação</a></li>
                <li><a href="/faq">FAQ</a></li>
                <li><a href="mailto:support@broker.com.br">Email</a></li>
            </ul>
        </div>
        
        <div class="footer-section">
            <h4>Legal</h4>
            <ul>
                <li><a href="/termos-de-servico">Termos de Serviço</a></li>
                <li><a href="/privacidade">Política de Privacidade</a></li>
                <li><a href="/compliance">Conformidade</a></li>
            </ul>
        </div>
        
        <div class="footer-section">
            <h4>Contato</h4>
            <p>Email: <a href="mailto:legal@broker.com.br">legal@broker.com.br</a></p>
            <p>Tel: +55 11 XXXX-XXXX</p>
        </div>
    </div>
    
    <div class="footer-bottom">
        <p>&copy; 2026 Broker SaaS Platform. Todos os direitos reservados.</p>
    </div>
</footer>
```

---

## 4. CHECKLIST DE DEPLOY

### Antes de Deploy
- [ ] Revisar todos documentos com Legal
- [ ] Testar endpoints de API
- [ ] CSS renderizar corretamente
- [ ] Links funcionando (relative and absolute)
- [ ] Markdown converter corretamente
- [ ] Páginas responsivas (mobile)
- [ ] Performance: <2s load time
- [ ] Segurança: Auth required para admin docs
- [ ] SEO: Meta tags corretos
- [ ] Accessibility: WCAG 2.1 AA

### Durante Deploy
- [ ] Build image Docker com novos arquivos
- [ ] Migração de dados (se necessário)
- [ ] Health checks passando
- [ ] Logs sem errors
- [ ] URLs públicas acessíveis

### Após Deploy
- [ ] Teste smoke (acessar páginas)
- [ ] Teste links (todos funcionam)
- [ ] Teste mobile (responsivo)
- [ ] Teste download (pdf/md)
- [ ] Monitoring ativo (uptime)
- [ ] Comunicado aos users

---

## 5. ESTRUTURA FINAL DE ARQUIVOS

```
Broker/
├── TERMS_OF_SERVICE.md
├── PROJECT_ANALYSIS_REPORT.md
├── COMPLIANCE_AND_DATA_HANDLING_GUIDE.md
├── COMPLIANCE_CHECKLIST.md
├── COMPLIANCE_DOCUMENTATION_INDEX.md
├── COMPLIANCE_DEPLOYMENT_GUIDE.md (este)
│
├── frontend/
│   ├── terms.html ............................ (novo)
│   ├── privacy.html .......................... (existente)
│   ├── compliance.html ....................... (novo - admin)
│   ├── css/
│   │   └── legal.css ......................... (novo)
│   └── components/
│       └── footer.html ....................... (update)
│
└── src/
    └── routes/
        ├── publicRoutes.js ................... (update)
        ├── pageRoutes.js ..................... (novo)
        └── adminRoutes.js .................... (update)
```

---

## 6. INSTRUÇÕES PASSO-A-PASSO

### Passo 1: Criar Arquivos
```bash
# Diretório frontend
touch frontend/terms.html
touch frontend/compliance.html
touch frontend/css/legal.css

# Copiar conteúdo dos arquivos Markdown para HTML templates
```

### Passo 2: Atualizar Routes
```javascript
// Em src/server.js, adicionar:
app.use('/api/content', require('./routes/publicRoutes'));
app.use('/', require('./routes/pageRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
```

### Passo 3: Build e Test Local
```bash
# Build Docker
docker build -t broker:latest .

# Run local
docker run -p 3001:3001 broker:latest

# Test URLs
curl http://localhost:3001/termos-de-servico
curl http://localhost:3001/privacidade
curl http://localhost:3001/compliance (com auth header)
```

### Passo 4: Deploy em Produção
```bash
# SSH para servidor
ssh user@broker.amber.com.br

# Deploy
docker pull broker:latest
docker-compose down
docker-compose up -d

# Verificar
curl https://broker.amber.com.br/termos-de-servico
```

---

## 7. TROUBLESHOOTING

| Problema | Solução |
|----------|---------|
| 404 em `/termos-de-servico` | Verificar rota em pageRoutes.js |
| Markdown não renderiza | Verificar markdown-converter.js |
| CSS não carrega | Verificar link em legal.css |
| Auth failing | Verificar token JWT em headers |
| Slow load | Implementar caching (Redis) |
| Mobile broken | Verificar media queries em CSS |

---

## 8. PRÓXIMOS PASSOS

1. **Hoje**: Criar arquivos HTML
2. **Amanhã**: Update routes e test local
3. **3º dia**: Deploy em staging
4. **4º dia**: Review e ajustes finais
5. **5º dia**: Deploy em produção

---

**Tempo Estimado Total**: 5 horas (desenvolvimento) + 1 hora (deploy) = **6 horas**

**Desenvolvedor Recomendado**: Fullstack ou Frontend Engineer

---

*Documento Preparado Por*: GitHub Copilot  
*Data*: 17 de abril de 2026  
*Versão*: 1.0
