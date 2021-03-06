import ReceivingStrategy from '../enum/ReceivingStrategy'

interface Option {
  url: string
  warning: boolean
  reconnect: boolean

  heartBeat: {
    warning: boolean
    enable: boolean
    sendMessage: string
    sendInterval: number
    receiveInterval: number
    receiveMessage: {
      pattern: string
      receivingStrategy: ReceivingStrategy
      regExp?: RegExp
    }
    heartStartFn?: Function
    heartColseFn?: Function
    heartFailFn?: Function
    breakOffHandler?: Function
  }
  forceDisconnectThreshold?: number
  hooks: {
    onOpen?: Function
    onClose?: Function
    onMessage?: Function
    onError?: Function
    onReconnecting?: Function
    onReconnected?: Function
    onReconnectFailed?: Function
  }
}
export default Option
