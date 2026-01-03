import React, { useContext } from 'react'
import Giscus from '@giscus/react'
import useSiteMetadata from '../hooks/use-site-config'
import { ThemeContext } from '../ThemeContext'

const GiscusWrapper = props => {
  const { giscusRepo } = useSiteMetadata()
  const { colorMode } = useContext(ThemeContext)

  if (!giscusRepo) {
    return null
  }

  const giscusTheme = colorMode === 'dark' ? 'dark' : 'light'

  return (
    <div style={{ marginTop: '2rem' }}>
      <Giscus
        id="comments"
        repo="kail-is/b.log"
        repoId="R_kgDOKOPhIA"
        category="Announcements"
        categoryId="DIC_kwDOKOPhIM4CthIX"
        mapping="pathname"
        strict="0"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="bottom"
        theme={giscusTheme}
        lang="ko"
        loading="lazy"
      />
    </div>
  )
}

export default GiscusWrapper