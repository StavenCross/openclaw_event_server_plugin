import { createNoopRuntimeLogger, resetRuntimeLogger, setRuntimeLogger } from '../src/logging';

beforeAll(() => {
  setRuntimeLogger(createNoopRuntimeLogger());
});

afterAll(() => {
  resetRuntimeLogger();
});
