import React, { useEffect } from 'react'

const GiscusScript = () => {
  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://giscus.app/client.js'
    script.setAttribute('data-repo', 'kail-is/b.log')
    script.setAttribute('data-repo-id', 'R_kgDOKOjNAA')
    script.setAttribute('data-category', 'General')
    script.setAttribute('data-category-id', 'DIC_kwDOKOjNAM4CcqTg')
    script.setAttribute('data-mapping', 'pathname')
    script.setAttribute('data-strict', '0')
    script.setAttribute('data-reactions-enabled', '1')
    script.setAttribute('data-emit-metadata', '0')
    script.setAttribute('data-input-position', 'top')
    script.setAttribute('data-theme', 'light')
    script.setAttribute('data-lang', 'ko')
    script.setAttribute('data-loading', 'lazy')
    script.crossOrigin = 'anonymous'
    script.async = true

    document.body.appendChild(script)

    return () => {
      // Cleanup: remove script when component unmounts
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [])

  return <div id="giscus-container" style={{ marginTop: '2rem' }} />
}

export default GiscusScript