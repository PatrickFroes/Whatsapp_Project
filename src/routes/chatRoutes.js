const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/ChatController');
const InternalNoteController = require('../controllers/InternalNoteController');
const TransferController = require('../controllers/TransferController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Chats
router.get('/chats', ChatController.listChats);
router.get('/chats/:phone/messages', ChatController.getMessages);
router.get('/history/:phone', ChatController.getMessages); // Alias for legacy/frontend support
router.post('/chats/:phone/send', ChatController.sendMessage);
router.post('/chats/:phone/resolve', ChatController.resolveChat);

// Internal Notes (em conversas)
router.get('/conversations/:conversationId/notes', InternalNoteController.list);
router.post('/conversations/:conversationId/notes', InternalNoteController.create);
router.get('/conversations/:conversationId/notes/count', InternalNoteController.count);

// Transfers (em conversas)
router.post('/conversations/:conversationId/transfer', TransferController.transfer);
router.post('/conversations/:conversationId/transfer-to-skill', TransferController.transferToSkill);
router.get('/conversations/:conversationId/transfers', TransferController.listTransfers);

// Status
router.get('/agent/status', ChatController.getStatus);
router.post('/agent/status', ChatController.updateStatus);
router.get('/pauses', ChatController.getPauses); // Agent pause reasons

module.exports = router;
