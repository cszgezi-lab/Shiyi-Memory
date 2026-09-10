import { initProductShell } from './ui/product-view.js';

export { initProductShell } from './ui/product-view.js';
export { createProductShellController } from './src/product-shell-controller.js';
export * from './src/product-settings.js';

/** Mount UI and follow the current chat locally; model requests remain explicit/opt-in. */
export function init(options = {}) {
  return initProductShell(options);
}
