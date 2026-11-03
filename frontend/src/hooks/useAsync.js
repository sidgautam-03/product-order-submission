import { useEffect, useState } from 'react'
import { isCancel } from '../api/client'

/**
 * Runs `fn(signal)` whenever `deps` change. The previous request is aborted and its result
 * ignored, so a slow, stale response can never overwrite a newer one.
 */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn(ctrl.signal)
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error) => {
        if (active && !isCancel(error)) setState({ data: null, loading: false, error })
      })
    return () => {
      active = false
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { ...state, reload: () => setTick((t) => t + 1) }
}
