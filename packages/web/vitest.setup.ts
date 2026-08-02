// jsdom doesn't implement ResizeObserver — stub it so components that use
// it (e.g. WeightBlock's dynamic sparkline) don't throw during tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom doesn't implement matchMedia — stub it so composables that call
// window.matchMedia (e.g. useIsMobile) don't throw during component tests.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
