import ReceivingStrategy from './enum/ReceivingStrategy'
import WebSocketStatus from './enum/WebSocketStatus'
import Option from './interfaces/Option'
import { warn } from './utils'

export default class BigoIO {
  static baseURL: string
  private option: Option
  private ws: WebSocket
  private url: string
  private messageQueue = [] // 消息队列
  private reconnecting = false

  private forceDisconnectTimer: any // 强制断开定时器
  private heartBeatTimer: any // 心跳发送定时器
  private heartBeatReceiptFlag = false // 是否需要进行心跳检查
  private heartBeatReceiptTimer: any // 心跳检查定时器
  private messageHeartBeatCheckList = [] // 心跳检查所需的消息列表

  private openHandler = undefined
  private messageHandler = undefined
  private errorHandler = undefined
  private closeHandler = undefined
  private reconnectingHandler = undefined
  private reconnectedHandler = undefined
  private reconnectFailedHandler = undefined

  constructor (option: Option) {
    this.checkOption(option)
    this.option = option

    if (option.url.startsWith('/')) {
      this.url = BigoIO.baseURL + option.url
    } else {
      this.url = option.url
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
    if (!option.hooks) {
      option.hooks = {}
    }
  }

  /**
   * 创建连接
   */
  createConnection () {
    if (this.ws) return
    this.ws = new WebSocket(this.url)
    this.ws.onopen = this.onOpenProxy.bind(this)
    this.ws.onclose = this.onCloseProxy.bind(this)
    this.ws.onmessage = this.onMessageProxy.bind(this)
    this.ws.onerror = this.onErrorProxy.bind(this)
  }

  /**
   * 创建一个IO实例
   */
  static create (options) {
    return new BigoIO(options)
  }

  /**
   * 开启事件
   * @param handler 用户的处理函数
   */
  onOpen (handler) {
    if (!this.ws) return
    this.openHandler = handler
    this.ws.onopen = this.onOpenProxy.bind(this)
  }

  /**
   * 开启代理
   * @param handler 用户的处理函数
   */
  onOpenProxy (e) {
    this.option.warning && console.warn('websocket connected')
    if (this.reconnecting) {
      this.reconnecting = false
      // global hooks
      if (this.option.hooks.onReconnected) {
        this.option.hooks.onReconnected(e)
      }

      if (this.reconnectedHandler) {
        this.reconnectedHandler(e)
      }
    }
    // global hooks
    if (this.option.hooks.onOpen) {
      this.option.hooks.onOpen(e)
    }
    if (this.openHandler) {
      this.openHandler(e)
    }

    // 推送消息队列
    if (this.messageQueue.length) {
      while (this.messageQueue.length) {
        const message = this.messageQueue.shift()

        this.send(message)
      }
    }
    // 心跳
    this.setHearBeat()
  }

  /**
   * 关闭事件
   * @param handler 用户的处理函数
   */
  onClose (handler) {
    if (!this.ws) return
    this.closeHandler = handler
    this.ws.onclose = this.onCloseProxy.bind(this)
  }

  /**
   * 关闭事件代理
   * @param handler 用户的处理函数
   */
  private onCloseProxy (e) {
    if (this.reconnecting) {
      this.reconnecting = false
      // global hooks
      if (this.option.hooks.onReconnectFailed) {
        this.option.hooks.onReconnectFailed(e)
      }
      if (this.reconnectFailedHandler) {
        this.reconnectFailedHandler(e)
      }
    }
    // 关闭心跳
    if (this.heartBeatTimer) {
      clearInterval(this.heartBeatTimer)
      this.heartBeatTimer = undefined
    }
    // 关闭心跳回执检查
    if (this.heartBeatReceiptTimer) {
      clearTimeout(this.heartBeatTimer)
      this.heartBeatReceiptTimer = undefined
    }
    this.ws = undefined
    // global hooks
    if (this.option.hooks.onClose) {
      this.option.hooks.onClose(e)
    }
    if (this.closeHandler) {
      this.closeHandler(e)
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
   * @param handler 用户的处理函数
   */
  public onMessage (handler) {
    if (!this.ws) return
    this.messageHandler = handler
    this.ws.onmessage = this.onMessageProxy.bind(this)
  }

  /**
   * 接受信息事件代理
   * @param handler 用户的处理函数
   * @returns
   */
  private onMessageProxy (e) {
    // global hooks
    if (this.option.hooks.onMessage) {
      this.option.hooks.onMessage(e)
    }
    if (this.messageHandler) {
      this.messageHandler(e)
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
   * @param handler 用户的处理函数
   */
  public onError (handler) {
    if (!this.ws) return
    this.errorHandler = handler
    this.ws.onerror = this.onErrorProxy.bind(this)
  }

  /**
   * 错误事件代理
   * @param handler 用户的处理函数
   * @returns
   */
  private onErrorProxy (e) {
    // global hooks
    if (this.option.hooks.onError) {
      this.option.hooks.onError(e)
    }
    if (this.errorHandler) {
      this.errorHandler(e)
    }
  }

  /**
   * 发送信息
   * @param message 信息
   */
  send (message: Object) {
    if (!this.ws) return
    if (
      this.ws.readyState === WebSocketStatus.CLOSED ||
      this.ws.readyState === WebSocketStatus.CLOSING
    ) {
      warn('websocket has been closed!')
    }
    if (this.ws.readyState === WebSocketStatus.CONNECTING) {
      this.messageQueue.push(message)
      return
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
    this.ws.close()
  }

  /**
   * 重新连接事件
   * @param handler 用户的处理函数
   * @returns
   */
  onReconnecting (handler) {
    if (!handler) return
    this.reconnectingHandler = handler
  }

  /**
   * 重新连接成功事件
   * @param handler 用户的处理函数
   * @returns
   */
  onReconnected (handler) {
    if (!handler) return
    this.reconnectedHandler = handler
  }

  /**
   * 重新连接失败事件
   * @param handler 用户的处理函数
   * @returns
   */
  onReconnectFailed (handler) {
    if (!handler) return
    this.reconnectFailedHandler = handler
  }

  /**
   * 重新连接
   */
  reConnect () {
    this.option.warning && console.warn('websocket connecting...')
    this.reconnecting = true
    // global hooks
    if (this.option.hooks.onReconnecting) {
      this.option.hooks.onReconnecting()
    }
    if (this.reconnectingHandler) {
      this.reconnectingHandler()
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
      this.send(sendMessage === undefined ? 'ping' : sendMessage)
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
