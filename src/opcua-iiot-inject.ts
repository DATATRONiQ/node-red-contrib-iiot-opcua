/**
 The BSD 3-Clause License

 Copyright 2022 - DATATRONiQ GmbH (https://datatroniq.com)
 Copyright (c) 2018,2019,2020,2021,2022 Klaus Landsdorf (https://bianco-royal.space/)
 Copyright 2013, 2016 IBM Corp. (node-red)
 All rights reserved.
 node-red-contrib-iiot-opcua
 **/
'use strict'
import * as nodered from "node-red";
import {NodeMessageInFlow} from "node-red";
import {Todo} from "./types/placeholders";
import coreInject from "./core/opcua-iiot-core-inject";
import {resetIiotNode} from "./core/opcua-iiot-core";
import {CronJob} from 'cron';
import {AddressSpaceItem} from "./types/helpers";

interface OPCUAIIoTInject extends nodered.Node {
  name: string
  topic: string
  payload: Todo // TODO: config.payload
  payloadType: Todo
  repeat: number
  crontab: string
  once: Todo
  startDelay: number // TODO: parseFloat(config.startDelay) || 10
  injectType: string
  addressSpaceItems: Todo // TODO: config.addressSpaceItems || []
}

interface OPCUAIIoTInjectConfigurationDef extends nodered.NodeDef {
  name: string
  topic: string
  payload: string
  payloadType: string
  repeat: string
  crontab: string
  once: boolean
  startDelay: string
  injectType: string
  addressSpaceItems: Todo // TODO: config.addressSpaceItems || []
}

export interface InjectMessage extends NodeMessageInFlow {
  payload: InjectPayload
}

export interface InjectPayload {
  value: any
  payloadType: string
  nodetype: 'inject'
  injectType: string
  addressSpaceItems: AddressSpaceItem[]
  manualInject: boolean
}

/**
 * Inject Node-RED node for OPC UA IIoT nodes.
 *
 * @param RED
 */

module.exports = function (RED: nodered.NodeAPI) {
  // SOURCE-MAP-REQUIRED

  function OPCUAIIoTInject(this: OPCUAIIoTInject, config: OPCUAIIoTInjectConfigurationDef) {
    RED.nodes.createNode(this, config)

    this.topic = config.topic
    this.payload = config.payload
    this.payloadType = config.payloadType
    this.crontab = config.crontab
    this.once = config.once
    this.startDelay = parseFloat(config.startDelay) || 10
    this.name = config.name
    this.injectType = config.injectType || 'inject'

    this.addressSpaceItems = config.addressSpaceItems || []

    let node: Todo = this

    let intervalId: NodeJS.Timer | null = null
    let onceTimeout: NodeJS.Timeout | null = null
    let cronjob: CronJob | null = null
    const REPEAT_FACTOR = 1000.0
    const ONE_SECOND = 1000
    const INPUT_TIMEOUT_MILLISECONDS = 1000

    const repeaterSetup = () => {
      coreInject.internalDebugLog('Repeat Is ' + node.repeat)
      coreInject.internalDebugLog('Crontab Is ' + node.crontab)
      if (node.repeat !== '') {
        node.repeat = parseFloat(config.repeat) * REPEAT_FACTOR

        if (node.repeat === 0) {
          node.repeat = ONE_SECOND
        }

        coreInject.internalDebugLog('Repeat Interval Start With ' + node.repeat + ' msec.')

        if (intervalId) {
          clearInterval(intervalId)
        }

        if (typeof node.repeat !== "number" || isNaN(node.repeat)) return;

        intervalId = setInterval(() => {
          this.emit('input', {
            _msgid: RED.util.generateId(), payload: {
              injectType: "cron"
            }
          })
        }, node.repeat)
      } else if (node.crontab !== '') {
        cronjob = new CronJob(node.crontab,
          () => {
            this.emit('input', {
              _msgid: RED.util.generateId(), payload: {
                injectType: "cron"
              }
            })
          },
          null,
          true)
      }
    }

    const resetAllTimer = function () {
      if (onceTimeout) {
        clearTimeout(onceTimeout)
        onceTimeout = null
      }

      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const generateOutputValue = (payloadType: string, inputMessage: NodeMessageInFlow) => {
      switch (payloadType) {
        case 'none':
          return ''
        case 'str':
          return node.payload.toString()
        case 'num':
          return Number(node.payload)
        case 'bool':
          return (node.payload === true || node.payload === 'true')
        case 'json':
          return JSON.parse(node.payload)
        case 'date':
          return Date.now()
        default:
          if (node.payloadType === null) {
            if (node.payload === '') {
              return Date.now()
            } else {
              return node.payload
            }
          } else {
            return RED.util.evaluateNodeProperty(node.payload, node.payloadType, this, inputMessage)
          }
      }
    }

    this.on('input', (msg: NodeMessageInFlow) => {
      if (Object.keys(msg).length === 0) return;
      try {
        const topic = node.topic || msg.topic
        const payload: InjectPayload = {
          payloadType: node.payloadType,
          value: generateOutputValue(node.payloadType, msg),
          nodetype: 'inject',
          injectType: (msg.payload as Todo)?.injectType || node.injectType,
          addressSpaceItems: [...node.addressSpaceItems],
          manualInject: Object.keys(msg).length !== 0
        }
        const outputMessage: NodeMessageInFlow = {
          ...msg,
          topic,
          payload,
        }
        this.send(outputMessage)
      } catch (err) {
        /* istanbul ignore next */
        if (RED.settings.verbose) {
          this.error(err, msg)
        }
      }
    })

    if (onceTimeout) {
      clearTimeout(onceTimeout)
      onceTimeout = null
    }
    let timeout = INPUT_TIMEOUT_MILLISECONDS * node.startDelay

    if (this.once) {
      coreInject.detailDebugLog('injecting once at start delay timeout ' + timeout + ' msec.')
      onceTimeout = setTimeout(() => {
        coreInject.detailDebugLog('injecting once at start')
        this.emit('input', {})
        repeaterSetup()
      }, timeout)
    } else if (node.repeat || node.crontab) {
      coreInject.detailDebugLog('start with delay timeout ' + timeout + ' msec.')
      onceTimeout = setTimeout(function () {
        coreInject.detailDebugLog('had a start delay of ' + timeout + ' msec. to setup inject interval')
        repeaterSetup()
      }, timeout)
    } else {
      repeaterSetup()
    }

    this.close = async (removed: boolean) => {

      if (cronjob) {
        cronjob.stop()
        delete node['cronjob']
      }
      resetIiotNode(node)
    }
  }

  RED.nodes.registerType('OPCUA-IIoT-Inject', OPCUAIIoTInject)

  RED.httpAdmin.post('/opcuaIIoT/inject/:id', RED.auth.needsPermission('opcuaIIoT.inject.write'), function (req, res) {
    const node = RED.nodes.getNode(req.params.id)
    if (node) {
      try {
        node.receive()
        res.sendStatus(200)
      } catch (err: any) {
        /* istanbul ignore next */
        res.sendStatus(500)
        node.error(RED._('opcuaiiotinject.failed', {error: err.toString()}))
      }
    } else {
      /* istanbul ignore next */
      res.sendStatus(404)
    }
  })
}
