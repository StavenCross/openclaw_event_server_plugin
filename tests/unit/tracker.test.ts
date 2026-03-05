/**
 * Unit tests for tool and session trackers
 */

import { ToolCallTracker, SessionTracker } from '../../src/hooks';

describe('ToolCallTracker', () => {
  let tracker: ToolCallTracker;

  beforeEach(() => {
    tracker = new ToolCallTracker();
  });

  afterEach(() => {
    tracker.clear();
  });

  it('should track a tool call', () => {
    const callId = tracker.startCall('web_search', { query: 'test' });
    
    expect(callId).toBeDefined();
    const call = tracker.getCall(callId);
    expect(call?.toolName).toBe('web_search');
    expect(call?.params).toEqual({ query: 'test' });
  });

  it('should end a tool call and return duration', async () => {
    const callId = tracker.startCall('web_search');
    
    // Wait a tiny bit to ensure duration > 0
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const result = tracker.endCall(callId);
    
    expect(result).toBeDefined();
    expect(result?.toolName).toBe('web_search');
    expect(result?.durationMs).toBeGreaterThanOrEqual(1);
  });

  it('should return null for unknown call ID', () => {
    const result = tracker.endCall('unknown-id');
    expect(result).toBeNull();
  });

  it('should clear all tracking', () => {
    tracker.startCall('tool1');
    tracker.startCall('tool2');
    
    tracker.clear();
    
    expect(tracker.getCall('any-id')).toBeNull();
  });

  it('should throw error for empty tool name', () => {
    expect(() => tracker.startCall('')).toThrow('Tool name must be a non-empty string');
  });

  it('should throw error for non-string tool name', () => {
    expect(() => tracker.startCall(null as any)).toThrow('Tool name must be a non-empty string');
  });

  it('should track multiple concurrent calls', () => {
    const call1 = tracker.startCall('tool1');
    const call2 = tracker.startCall('tool2');
    const call3 = tracker.startCall('tool3');
    
    expect(tracker.getActiveCallCount()).toBe(3);
    expect(tracker.getCall(call1)?.toolName).toBe('tool1');
    expect(tracker.getCall(call2)?.toolName).toBe('tool2');
    expect(tracker.getCall(call3)?.toolName).toBe('tool3');
  });

  it('should get active call count', () => {
    const call1 = tracker.startCall('tool1');
    const call2 = tracker.startCall('tool2');
    
    expect(tracker.getActiveCallCount()).toBe(2);
    
    tracker.endCall(call1);
    expect(tracker.getActiveCallCount()).toBe(1);
    
    tracker.endCall(call2);
    expect(tracker.getActiveCallCount()).toBe(0);
  });
});

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    tracker = new SessionTracker();
  });

  afterEach(() => {
    tracker.clear();
  });

  it('should track a session', () => {
    tracker.startSession('session-123', 'main', 'parent-456');
    
    const session = tracker.getSession('session-123');
    expect(session).toBeDefined();
    expect(session?.agentId).toBe('main');
    expect(session?.parentSessionId).toBe('parent-456');
  });

  it('should end a session and return duration', async () => {
    tracker.startSession('session-123');
    
    // Wait a tiny bit
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const result = tracker.endSession('session-123');
    
    expect(result).toBeDefined();
    expect(result?.durationMs).toBeGreaterThanOrEqual(1);
  });

  it('should return null for unknown session', () => {
    const result = tracker.endSession('unknown-session');
    expect(result).toBeNull();
  });

  it('should track multiple sessions', () => {
    tracker.startSession('session-1');
    tracker.startSession('session-2');
    tracker.startSession('session-3');
    
    const activeSessions = tracker.getActiveSessions();
    expect(activeSessions).toHaveLength(3);
    expect(activeSessions).toContain('session-1');
    expect(activeSessions).toContain('session-2');
    expect(activeSessions).toContain('session-3');
  });

  it('should remove session when ended', () => {
    tracker.startSession('session-1');
    tracker.startSession('session-2');
    
    tracker.endSession('session-1');
    
    const activeSessions = tracker.getActiveSessions();
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions).toContain('session-2');
  });

  it('should clear all tracking', () => {
    tracker.startSession('session-1');
    tracker.startSession('session-2');
    
    tracker.clear();
    
    expect(tracker.getActiveSessions()).toHaveLength(0);
  });

  it('should throw error for empty session key', () => {
    expect(() => tracker.startSession('')).toThrow('Session key must be a non-empty string');
  });

  it('should throw error for non-string session key', () => {
    expect(() => tracker.startSession(null as any)).toThrow('Session key must be a non-empty string');
  });

  it('should get active session count', () => {
    expect(tracker.getActiveSessionCount()).toBe(0);
    
    tracker.startSession('session-1');
    expect(tracker.getActiveSessionCount()).toBe(1);
    
    tracker.startSession('session-2');
    expect(tracker.getActiveSessionCount()).toBe(2);
    
    tracker.endSession('session-1');
    expect(tracker.getActiveSessionCount()).toBe(1);
  });

  it('should track session without optional params', () => {
    tracker.startSession('session-123');
    
    const session = tracker.getSession('session-123');
    expect(session).toBeDefined();
    expect(session?.agentId).toBeUndefined();
    expect(session?.parentSessionId).toBeUndefined();
  });
});
