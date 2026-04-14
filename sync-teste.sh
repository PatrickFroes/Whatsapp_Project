#!/bin/bash
docker exec broker_app node -e '
const p = require("./src/services/database");
(async () => {
  const t = await p.tenant.findFirst({
    where: {name: "TesteEmpresa"},
    include: {configuration: true}
  });
  if(t && t.configuration) {
    console.log("Sincronizando TesteEmpresa...");
    await p.tenant.update({
      where: {id: t.id},
      data: {waPhoneId: t.configuration.phoneNumberId}
    });
    const updated = await p.tenant.findUnique({where: {id: t.id}});
    console.log("OK TesteEmpresa sincronizado:");
    console.log("  waPhoneId:", updated.waPhoneId);
  } else {
    console.log("ERRO: TesteEmpresa ou config nao encontrado");
  }
  process.exit(0);
})();
'