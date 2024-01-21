import 'dotenv/config'
import { FmtString } from 'telegraf/format'
import { IndexedTx, StargateClient} from '@cosmjs/stargate'
import { fmt, link, bold, code } from 'telegraf/format'
import { DecodedTX } from '../decodeTxs'
import { cosmwasm, ibc } from "juno-network"
import { minAmountPHMN as minAmountPHMNprod, minAmountPHMNtest,
    explorerTxJunoURL, contractPHMNJuno, contractDASHold, contractIbcPhmnJuno } from '../../config.json'
import { getDaoDaoNickname } from '../daoDaoNames'

const DEPLOYMENT = process.env.DEPLOYMENT
const minAmountPHMN = DEPLOYMENT === 'production'? minAmountPHMNprod : minAmountPHMNtest

let ibcMsgsBuffer: {
    packet_sequence: string,
    telegramMsg: FmtString
}[] = []
function deleteIbcTx (sequence: string) {
    ibcMsgsBuffer = ibcMsgsBuffer.filter((msg) => msg.packet_sequence !== sequence)
}

export async function processTxsJuno (decodedTxs: DecodedTX[], queryClient: StargateClient) {
    const telegramMsgs: FmtString[] = []
    for (const tx of decodedTxs) {
        //console.log(tx)
        let telegramMsg = fmt``
        let countMsgs = 0
        let indexedTx: IndexedTx | null = null
        for (let i = 0; i < tx.msgs.length; i++) {
            // #Juno #MsgExecuteContract
            if (tx.msgs[i].typeUrl === '/cosmwasm.wasm.v1.MsgExecuteContract') {
                const msg = cosmwasm.wasm.v1.MsgExecuteContract.decode(tx.msgs[i].value)
                // #PHMNcontract
                if (msg.contract === contractPHMNJuno) {
                    const executeContractMsg = JSON.parse(new TextDecoder().decode(msg.msg))
                    // #Send
                    if (executeContractMsg.transfer) {
                        const amount = +executeContractMsg.transfer.amount/1e6
                        if (amount >= minAmountPHMN) {
                            if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                            if (indexedTx?.code === 0) {
                                const sender = msg.sender
                                const toAddress = executeContractMsg.transfer.recipient as string
                                
                                if (countMsgs === 0) {
                                    const [
                                        senderDaoDaoNick,
                                        toAddressDaoDaoNick
                                    ] = await Promise.all([
                                        getDaoDaoNickname(sender),
                                        getDaoDaoNickname(toAddress)
                                    ]) 
                                    
                                    telegramMsg = fmt(telegramMsg, '🐳  #Juno #Send  📬\n', 
                                        'Address ', code(sender), senderDaoDaoNick, ' sent ', bold(amount.toString() + ' PHMN'), ' to ', code(toAddress), toAddressDaoDaoNick, '\n'
                                    )
                                } else {
                                    const toAddressDaoDaoNick = await getDaoDaoNickname(toAddress)
                            
                                    if (countMsgs > 1) telegramMsg.text = telegramMsg.text.replace(/...\n$/, '')
                                    telegramMsg = fmt(telegramMsg, '🐳  #Juno #Send  📬\n', 
                                        'sent ', bold(amount.toString() + ' PHMN'), ' to ', code(toAddress), toAddressDaoDaoNick, '\n',
                                        '...\n'
                                    )
                                }
                                countMsgs++
                            }
                        }
                    // #Mint
                    } else if (
                        executeContractMsg.mint &&
                        +executeContractMsg.mint.amount/1e6 >= minAmountPHMN
                    ) {
                        if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                        if (indexedTx?.code === 0) {
                            const amount = +executeContractMsg.mint.amount/1e6
                            
                            const sender = msg.sender
                            const senderDaoDaoNick = await getDaoDaoNickname(sender)

                            telegramMsg = fmt(telegramMsg, '🐳  #Mint  🪙\n', 
                                'Address ', code(sender), senderDaoDaoNick, ' minted ', 
                                bold(amount.toString() + ' PHMN'), '\n'
                            )
                            countMsgs++
                        }
                    // #DAS
                    } else if (
                        executeContractMsg.send &&
                        executeContractMsg.send.contract === contractDASHold
                    ) {
                        const amount = +executeContractMsg.send.amount/1e6
                        if (amount >= minAmountPHMN) {
                            if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                            if (indexedTx?.code === 0) {
                                const dasMsg = JSON.parse(new TextDecoder().decode(Buffer.from(executeContractMsg.send.msg, 'base64')))
                                const sender = msg.sender
                                const senderDaoDaoNick = await getDaoDaoNickname(sender)
                                
                                // #DAS #Hold
                                if (dasMsg.stake) {
                                    telegramMsg = fmt(telegramMsg, '🐳  #DAS #Hold  🔐\n', 
                                        'Address ', code(sender), senderDaoDaoNick, 
                                        ' just increased holdings in the DAS by ', 
                                        bold(amount.toString() + ' PHMN'), '\n'
                                    )
                                    countMsgs++
                                }
                            }
                        }
                    // #IBCtransfer #Send
                    } else if (
                        executeContractMsg.send &&
                        executeContractMsg.send.contract === contractIbcPhmnJuno
                    ) {
                        const amount = +executeContractMsg.send.amount/1e6
                        const sender = msg.sender
                        const ibcMsg = JSON.parse(new TextDecoder().decode(Buffer.from(executeContractMsg.send.msg, 'base64')))
                        const receiver = ibcMsg.remote_address as string
                        const timeout = ibcMsg.timeout as number
                        if (amount >= minAmountPHMN) {
                            if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                            if (indexedTx?.code === 0) {
                                const packet_sequence = indexedTx.events.find((evnt) => 
                                    evnt.type === 'send_packet' && 
                                    JSON.parse(evnt.attributes.find((attr) => attr.key === 'packet_data')!.value)
                                        .amount === Math.round(amount*1e6).toString() &&
                                    JSON.parse(evnt.attributes.find((attr) => attr.key === 'packet_data')!.value)
                                        .receiver === receiver
                                )?.attributes.find((attr) => attr.key === 'packet_sequence')?.value || ''
                                
                                const [
                                    senderDaoDaoNick,
                                    receiverDaoDaoNick
                                ] = await Promise.all([
                                    getDaoDaoNickname(sender),
                                    getDaoDaoNickname(receiver),
                                ])
    
                                telegramMsg = fmt(telegramMsg, '🐳  #Juno #IBCtransfer  📬\n', 
                                    'Address ', code(sender), senderDaoDaoNick, ' sent over IBC protocol ', 
                                    bold(amount.toString() + ' PHMN'),
                                    ' to ', code(receiver), receiverDaoDaoNick, '\n',
                                    link('TX link', explorerTxJunoURL + tx.txId)
                                )
                                if (tx.memo !== '') {
                                    telegramMsg = fmt(telegramMsg, '\n\n memo: ', tx.memo)
                                }

                                ibcMsgsBuffer.push({
                                    packet_sequence,
                                    telegramMsg
                                })
                                setTimeout(deleteIbcTx, timeout*1000, packet_sequence)
                            }
                        }
                    }
                // #DAS
                } else if (msg.contract === contractDASHold) {
                    const executeContractMsg = JSON.parse(new TextDecoder().decode(msg.msg))
                    // #DAS #Withdraw
                    if (executeContractMsg.claim) {
                        if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                        if (indexedTx?.code === 0) {
                            const amount = +(indexedTx.events.find((ev) =>
                                ev.type === 'wasm' &&
                                ev.attributes.find((atr) => atr.key === '_contract_address')?.value === contractPHMNJuno
                            )?.attributes.find((atr) => atr.key === 'amount')?.value || '0')/1e6
                            if (amount >= minAmountPHMN) {
                                const sender = msg.sender
                                const senderDaoDaoNick = await getDaoDaoNickname(sender)

                                telegramMsg = fmt(telegramMsg, '🐳  #DAS #Withdraw  📬🪙📭\n', 
                                    'Address ', code(sender), senderDaoDaoNick, ' withdraw from the DAS ', bold(amount.toString() + ' PHMN'), '\n'
                                )
                                countMsgs++
                            }
                        }
                    // #DAS #Unlock
                    } else if (executeContractMsg.unstake) {
                        if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                        if (indexedTx?.code === 0) {
                            const amount = +executeContractMsg.unstake.amount/1e6
                            if (amount >= minAmountPHMN) {
                                const sender = msg.sender
                                const senderDaoDaoNick = await getDaoDaoNickname(sender)
                                const claimDuration = +(indexedTx.events.find((evnt) => 
                                    evnt.type === 'wasm' &&
                                    evnt.attributes.find((atr) => 
                                        atr.key === 'claim_duration'
                                    )
                                )?.attributes.find((atr) => 
                                    atr.key === 'claim_duration'
                                )?.value.replace('time: ', '') || '-86400')/86400

                                telegramMsg = fmt(telegramMsg, '🐳  #DAS #Unlock  🔓\n', 
                                    'Address ', code(sender), senderDaoDaoNick, ' requested unlock ', 
                                    bold(amount.toString() + ' PHMN'), ' from DAS. Claim duration ', 
                                    claimDuration.toString(), ' days\n'
                                )
                                countMsgs++
                            }
                        }
                    }
                }
            // #IbcAcknowledgevent
            } else if (tx.msgs[i].typeUrl === '/ibc.core.channel.v1.MsgAcknowledgement') {
                const msg = ibc.core.channel.v1.MsgAcknowledgement.decode(tx.msgs[i].value)
                const packeSequence = msg.packet?.sequence.toString()||''
                const telegramMsg = ibcMsgsBuffer.find((msg) => msg.packet_sequence === packeSequence)?.telegramMsg
                if (telegramMsg) {
                    deleteIbcTx(packeSequence)
                    const acknowledgement = JSON.parse(new TextDecoder().decode(msg.acknowledgement))
                    if (acknowledgement.result === 'AQ==') {
                        if (indexedTx === null) indexedTx = await queryClient.getTx(tx.txId)
                        if (indexedTx?.code === 0) {
                            telegramMsgs.push(telegramMsg)
                        }
                    }
                }
            }
        }
        
        if (countMsgs > 0) {
            telegramMsg = fmt(telegramMsg, link('TX link', explorerTxJunoURL + tx.txId))
            if (tx.memo !== '') {
                telegramMsg = fmt(telegramMsg, '\n\n memo: ', tx.memo)
            }
            
            telegramMsgs.push(telegramMsg)
        }
    }
    return telegramMsgs
}
