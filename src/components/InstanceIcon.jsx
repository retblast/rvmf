import { useEffect, useState } from 'react'
import { Rss } from 'lucide-react'

// The current instance's favicon ({origin}/favicon.ico), falling back to
// the app's own glyph when it can't be fetched.
export default function InstanceIcon({ instanceUrl, size = 18 }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [instanceUrl])

  if (!instanceUrl || failed) return <Rss size={size} />
  return (
    <img
      className="headerbar-instance-icon"
      src={`${instanceUrl}/favicon.ico`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  )
}
