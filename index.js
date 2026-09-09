import { initProductShell } from './ui/product-view.js';

export { initProductShell } from './ui/product-view.js';
export { createProductShellController } from './src/product-shell-controller.js';
export * from './src/product-settings.js';

/** Formal extension entry. Loading mounts the shell only; all host work is button-driven. */
export function init(options = {}) {
  return initProductShell(options);
}
