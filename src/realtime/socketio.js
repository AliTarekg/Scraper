const { Server } = require('socket.io');

let io = null;

function initSocketIO(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // Join a specific job room for real-time updates
    socket.on('join:job', (jobId) => {
      const room = `job:${jobId}`;
      socket.join(room);
      console.log(`[Socket.IO] ${socket.id} joined ${room}`);
    });

    socket.on('leave:job', (jobId) => {
      const room = `job:${jobId}`;
      socket.leave(room);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  return io;
}

/**
 * Emit an event to all clients watching a specific job.
 */
function emitToJob(jobId, event, data) {
  if (io) {
    io.to(`job:${jobId}`).emit(event, data);
  }
}

/**
 * Emit a global event to all connected clients.
 */
function emitGlobal(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

module.exports = { initSocketIO, getIO, emitToJob, emitGlobal };
