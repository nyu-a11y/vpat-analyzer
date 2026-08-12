// PDF.js 4.x uses Promise.withResolvers during module initialization. Safari
// gained it after the product's Safari 16 floor, so install the audited
// standards-equivalent primitive before evaluating PDF.js.
if (typeof Promise.withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value() {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    },
  });
}
