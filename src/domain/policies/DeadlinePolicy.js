function isBeforeDeadline(nowMs, deadlineMs) {
  if (!nowMs || !deadlineMs) return false;
  return nowMs <= deadlineMs;
}

module.exports = { isBeforeDeadline };
