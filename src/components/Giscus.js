import React from 'react'
import Giscus from '@giscus/react'
import useSiteMetadata from '../hooks/use-site-config'

const GiscusWrapper = props => {
  const { giscusRepo } = useSiteMetadata()

  if (!giscusRepo) {
    return null
  }

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
        theme="preferred_color_scheme"
        lang="ko"
        loading="lazy"
      />
    </div>
  )
}

export default GiscusWrapper