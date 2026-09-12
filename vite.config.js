import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名がサブパスになるため、
// 環境変数 BASE_PATH（GitHub Actions側で設定）が無ければ './' を使う。
// './' にしておくことで、リポジトリ名が変わっても index.html をそのまま
// どこに置いても相対パスで動作する。
export default defineConfig({
  base: process.env.BASE_PATH || './',
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  server: {
    port: 5173
  }
});
