const { run, all } = require('./db');

function createNotification(userId, message) {
  run(
    `INSERT INTO notifications (user_id, message, created_at) VALUES (?, ?, datetime('now'))`,
    [userId, message]
  );
}

function getUnreadNotifications(userId) {
  return all(
    `SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC`,
    [userId]
  );
}

function markAsRead(notificationId, userId) {
  run(
    `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
}

module.exports = {
  createNotification,
  getUnreadNotifications,
  markAsRead
};
