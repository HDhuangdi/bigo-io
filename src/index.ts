import ReceivingStrategy from './enum/ReceivingStrategy'
import WebSocketStatus from './enum/WebSocketStatus'
import Option from './interfaces/Option'
import { warn } from './utils'

export default class BigoIO {
  static baseURL: string
  private option: Option
  private ws: WebSocket
  private url: string

  private forceDisconnectTimer: any // 强制断开定时器
  private heartBeatTimer: any // 心跳发送定时器
  private heartBeatReceiptFlag = false // 是否需要进行心跳检查
  private heartBeatReceiptTimer: any // 心跳检查定时器
  private messageHeartBeatCheckList = [] // 心跳检查所需的消息列表

  constructor (option: Option) {
    this.checkOption(option)
    this.option = option
    if (option.url.startsWith('/')) {
      this.url = BigoIO.baseURL + option.url
    }
    this.createConnection()
  }

  /**
   * 检查配置项合法性
   * @param option 配置项
   */
  checkOption (option) {
    if (typeof window.WebSocket === 'undefined') {
      warn("Your browser doesn't support websocket!")
    }
    if (!option || !Object.keys(option).length) {
      warn('invalid options!')
    }
    if (!option.url) {
      warn('invalid url!')
    }
  }

  /**
   * 创建连接
   */
  createConnection () {
    this.ws = new WebSocket(this.url)
    this.ws.onopen = this.onOpen.bind(this)
    this.ws.onclose = this.onClose.bind(this)
    this.ws.onmessage = this.onMessage.bind(this)
    this.ws.onerror = this.onError.bind(this)
  }

  /**
   * 创建一个IO实例
   */
  static create (options) {
    return new BigoIO(options)
  }

  /**
   * 开启事件
   * @param e event
   */
  onOpen (e: any) {
    this.option.warning && console.warn('websocket connected')
    if (this.option.onOpen) {
      this.option.onOpen(e)
    }
    // 心跳
    this.setHearBeat()
  }

  /**
   * 关闭事件
   * @param e event
   */
  onClose (e: any) {
    if (this.option.onClose) {
      this.option.onClose(e)
    }
    this.option.warning && console.warn('websocket is closed,code:' + e.code)
    // 重连
    if (this.option.reconnect) {
      setTimeout(() => {
        this.reConnect()
      }, 2000)
    }
  }

  /**
   * 接受信息事件
   * @param e event
   */
  onMessage (e: any) {
    if (this.option.onMessage) {
      this.option.onMessage(e)
    }
    this.checkHeartBeat(e.data)

    if (!this.option.forceDisconnectThreshold) return
    // If {{threshold}} seconds no message. Force disconnect
    clearTimeout(this.forceDisconnectTimer)
    this.forceDisconnectTimer = setTimeout(() => {
      this.option.warning &&
        console.warn(
          this.option.forceDisconnectThreshold +
            'ms seconds no message. Force disconnect'
        )
      this.close()
    }, this.option.forceDisconnectThreshold)
  }

  /**
   * 错误事件
   * @param e event
   */
  onError (e: any) {
    if (this.option.onError) {
      this.option.onError(e)
    }
  }

  /**
   * 发送信息
   * @param message 信息
   */
  send (message: Object) {
    if (!this.ws) return
    if (this.ws.readyState !== WebSocketStatus.OPEN) {
      warn('websocket has been closed or not ready yet!')
    }
    const _message = JSON.stringify(message)
    this.ws.send(_message)
  }

  /**
   * 关闭连接
   */
  close () {
    if (!this.ws || this.ws.readyState === WebSocketStatus.CLOSED) return
    if (this.ws.readyState === WebSocketStatus.CLOSING) {
      warn('websocket is closing!')
    }
    // 关闭心跳
    if (this.heartBeatTimer) {
      this.heartBeatTimer = undefined
    }
    // 关闭心跳回执检查
    if (this.heartBeatReceiptTimer) {
      this.heartBeatReceiptTimer = undefined
    }
    this.ws.close()
  }

  /**
   * 重新连接
   */
  reConnect () {
    this.option.warning && console.warn('websocket connecting...')
    if (this.option.onReconnecting) {
      this.option.onReconnecting()
    }
    this.createConnection()
  }

  /**
   * 心跳机制
   */
  setHearBeat () {
    const { enable, sendMessage, sendInterval } = this.option.heartBeat
    if (!enable) return
    this.heartBeatTimer = setInterval(() => {
      if (this.ws.readyState !== WebSocketStatus.OPEN) return
      this.send({
        sub: sendMessage || 'ping'
      })
      this.heartBeatReceiptFlag = true
    }, sendInterval || 1000)
  }

  /**
   * 心跳回执检查
   * @param message
   * @returns
   */
  checkHeartBeat (message) {
    const { enable, receiveMessage, receiveInterval, breakOffHandler } =
      this.option.heartBeat

    if (!enable || !this.heartBeatReceiptFlag) return

    this.messageHeartBeatCheckList.push(message)
    if (this.heartBeatReceiptTimer) return

    this.heartBeatReceiptTimer = setTimeout(() => {
      if (!this.findHeartBeatReceipt(receiveMessage)) {
        this.option.heartBeat.warning &&
          console.warn('heart beat message not found')
        breakOffHandler && breakOffHandler()
      }
      this.messageHeartBeatCheckList = []
      this.heartBeatReceiptFlag = false
      this.heartBeatReceiptTimer = 0
    }, receiveInterval || 1000)
  }

  /**
   * 根据不同策略匹配不同的心跳回执
   * 默认为 match 模式
   * @param receiveMessage
   */
  private findHeartBeatReceipt (receiveMessage: any): boolean {
    return this.messageHeartBeatCheckList.some((message) => {
      switch (receiveMessage.receivingStrategy) {
        case ReceivingStrategy.absolutely:
          return message === receiveMessage.pattern
        case ReceivingStrategy.contain:
          return message.indexOf(receiveMessage.pattern) !== -1
        case ReceivingStrategy.startsWidth:
          return message.startsWith(receiveMessage.pattern)
        case ReceivingStrategy.endsWidth:
          return message.endsWith(receiveMessage.pattern)
        case ReceivingStrategy.match:
          return message.search(receiveMessage.regExp || /\*/) !== -1
        default:
          return message === receiveMessage.pattern
      }
    })
  }
}
