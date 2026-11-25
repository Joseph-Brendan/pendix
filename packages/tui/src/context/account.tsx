import { createContext, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"

export type TuiAccountSnapshot = Readonly<{
  displayName: string
  plan: string
  accountKind?: string
  offline: boolean
  teachLock?: string
  credits?: number
}>

export type TuiAccountSource = Readonly<{
  current: () => TuiAccountSnapshot | undefined
  subscribe?: (listener: (next: TuiAccountSnapshot | undefined) => void) => () => void
}>

const AccountContext = createContext<() => TuiAccountSnapshot | undefined>(() => undefined)

export function TuiAccountProvider(props: ParentProps<{ source?: TuiAccountSource }>) {
  const [account, setAccount] = createSignal<TuiAccountSnapshot | undefined>(props.source?.current())
  const unsubscribe = props.source?.subscribe?.((next) => setAccount(() => next))
  if (unsubscribe) onCleanup(unsubscribe)
  return <AccountContext.Provider value={account}>{props.children}</AccountContext.Provider>
}

export function useTuiAccount() {
  return useContext(AccountContext)
}
