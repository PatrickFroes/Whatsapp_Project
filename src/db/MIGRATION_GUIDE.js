// Este arquivo documenta os índices que devem ser adicionados ao schema.prisma para otimização

/*

ADD THESE INDEXES TO prisma/schema.prisma:

// Conversation indexes - Queries frequentes por tenantId + status
index([tenantId, status])
index([tenantId, updatedAt])
index([tenantId, lastMessageAt])

// Message indexes - Queries por conversação
index([conversationId, createdAt])
index([conversationId, status])

// User indexes - Autenticação e busca
index([tenantId, email], {unique: true})
index([tenantId, isActive])

// Tenant indexes - Multi-tenancy
index([id], {unique: true})

// Webhook indexes - Rastreamento
index([tenantId, createdAt])
index([id, messageId])

// Exemplos de como adicionar ao schema:

model Conversation {
  // ... existing fields ...

  // Índices de otimização
  @@index([tenantId, status])
  @@index([tenantId, updatedAt])
  @@index([tenantId, lastMessageAt])
}

model Message {
  // ... existing fields ...

  @@index([conversationId, createdAt])
  @@index([conversationId, status])
}

model User {
  // ... existing fields ...

  @@index([tenantId, email])
  @@index([tenantId, isActive])
  @@unique([tenantId, email])
}

AFTER UPDATING SCHEMA.PRISMA, RUN:
npx prisma migrate dev --name add_performance_indexes

*/

module.exports = {
  migrationInfo: 'See comments above for Prisma schema indexes to add for performance optimization'
};
