const { handleSocketConnection } = require('../src/services/socket');

describe('Socket cross-tenant access protection', () => {
  function createMockSocket() {
    const handlers = {};
    const socket = {
      id: 'socket-1',
      user: { userId: 'user-1', tenantId: 'tenant-1', role: 'AGENT' },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event, cb) => {
        handlers[event] = cb;
      })
    };

    return { socket, handlers };
  }

  it('denies join_tenant for different tenant', async () => {
    const { socket, handlers } = createMockSocket();
    const prismaMock = { conversation: { findFirst: jest.fn() } };

    handleSocketConnection(socket, prismaMock);

    handlers.join_tenant('tenant-2');

    expect(socket.join).toHaveBeenCalledWith('tenant:tenant-1');
    expect(socket.emit).toHaveBeenCalledWith('join_denied', {
      scope: 'tenant',
      requestedTenantId: 'tenant-2'
    });
  });

  it('denies joining conversation from another tenant', async () => {
    const { socket, handlers } = createMockSocket();
    const prismaMock = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };

    handleSocketConnection(socket, prismaMock);

    await handlers.join_conversation('conv-foreign');

    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv-foreign', tenantId: 'tenant-1' },
      select: { id: true }
    });
    expect(socket.join).not.toHaveBeenCalledWith('conversation:conv-foreign');
    expect(socket.emit).toHaveBeenCalledWith('join_denied', {
      scope: 'conversation',
      conversationId: 'conv-foreign'
    });
  });
});
