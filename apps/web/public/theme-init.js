(function () {
  try {
    var theme = localStorage.getItem('theme')
    if (theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
    }
  } catch (_error) {
    // localStorage pode estar indisponível em modos privados restritivos.
  }
})()
