const shadcn = require('ui/postcss.config')

module.exports = {
  ...shadcn,
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
