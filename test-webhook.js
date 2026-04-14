const p = require("./src/services/database");
(async () => {
  const t = await p.tenant.findFirst({where:{name:"TesteEmpresa"},include:{configuration:true}});
  console.log("=== TesteEmpresa Status ===");
  console.log("waPhoneId:", t.waPhoneId);
  console.log("phoneNumberId:", t.configuration.phoneNumberId);
  console.log("verifyToken:", t.configuration.verifyToken ? "SET" : "VAZIO");
  console.log("whatsappToken:", t.configuration.whatsappToken ? "SET" : "VAZIO");
  console.log("metaAppSecret:", t.configuration.metaAppSecret ? "SET" : "VAZIO");
  console.log("");
  console.log("=== Webhook Routing Test ===");
  const webhook_tenant = await p.tenant.findFirst({where:{waPhoneId:t.waPhoneId}});
  console.log("Busca webhook by waPhoneId:", webhook_tenant ? "OK" : "FAIL");
  process.exit(0);
})();