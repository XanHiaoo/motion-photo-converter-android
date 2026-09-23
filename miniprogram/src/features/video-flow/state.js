const VIDEO_FLOW_STATES = Object.freeze({
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  READY: 'ready',
  WORKING: 'working',
  SUCCESS: 'success',
  ERROR: 'error',
});

function createInitialVideoState() {
  return {
    status: VIDEO_FLOW_STATES.IDLE,
    source: null,
    durationSeconds: 0,
    width: 0,
    height: 0,
    clipStartSeconds: 0,
    clipEndSeconds: 0,
    coverTimeSeconds: 0,
    coverPath: null,
    outputPath: null,
    error: null,
  };
}

module.exports = { VIDEO_FLOW_STATES, createInitialVideoState };
