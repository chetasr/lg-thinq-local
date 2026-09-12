import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/H11'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'H11'
const META: Metadata = { modelId: MODEL_ID, modelName: 'H11', swVersion: '0.0.0' }

// Mock 32ec packet (54 bytes)
// 0~27: padding/old status
// 28~29: 00 18
// 30: State (02 = RUNNING)
// 31: Process (00)
// 32: unused
// 33, 34: Initial time (01, 30 = 1 hour 30 min)
// 35: Course (01 = AUTO)
// 36: unused
// 37, 38: Remain time (01, 15 = 1 hour 15 min)
// 39: Delay start (00 = off)
// 40: unused
// 41: Door & Opt1 (0x40 = Clean Reminder ON)
// 42: Wash Options (0x0c = High Temp + Extra Dry)
// 43: Rinse Level (02)
// 44: Salt Level (03)
// 45: Buzzer & Remote (0x80 = Buzzer High)
// 46: Opt2 (0x80 = Remote Permanent)
// 47: unused
// 48: unused
// 49: Opt3 (0x40 = Brightness High)
// 50: Smart Course (00 = none)
// 51: Extra Rinse (10 = 1 level)
// 52, 53: unused
const RUNNING_STATUS = buf(
    '00000000000000000000000000000000000000000000000000000000001802000001300100010f0000400c0203808000004000100000',
)

describe('H11 Dishwasher', () => {
    test('parses RUNNING status correctly', () => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META as any)
        const dut = new DUT(ha as any, thinq as any, META)
        dut.start()

        // Send 32 ec status
        const packet = Buffer.alloc(54)
        packet[0] = 0x32
        packet[1] = 0xec
        RUNNING_STATUS.copy(packet, 2, 2) // Copy from index 2 onwards

        dut.processAABB(packet)

        assert.equal(ha.devices[DEVICE_ID].properties['state'], 'Running')
        assert.equal(ha.devices[DEVICE_ID].properties['power'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['course'], 'Auto')
        assert.equal(ha.devices[DEVICE_ID].properties['course_time'], 108) // 1h 30m
        assert.equal(ha.devices[DEVICE_ID].properties['remain_time'], 75) // 1h 15m
        assert.equal(ha.devices[DEVICE_ID].properties['delay_start'], 0)
        assert.equal(ha.devices[DEVICE_ID].properties['door'], 'CLOSE')
        assert.equal(ha.devices[DEVICE_ID].properties['extra_dry'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['high_temp'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['remote_start'], 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties['rinse_level'], 2)
        assert.equal(ha.devices[DEVICE_ID].properties['salt_level'], 3)
        assert.equal(ha.devices[DEVICE_ID].properties['auto_dry'], 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties['clean_reminder'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['buzzer_level'], 'HIGH')
        assert.equal(ha.devices[DEVICE_ID].properties['remote_start_mode'], 'PERMANENT')
        assert.equal(ha.devices[DEVICE_ID].properties['end_alarm_sound'], 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties['brightness'], 'HIGH')
        assert.equal(ha.devices[DEVICE_ID].properties['extra_rinse'], 'Level 1')
    })

    test('parses 32 3e statistics packet', () => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META as any)
        const dut = new DUT(ha as any, thinq as any, META)
        dut.start()

        dut.processAABB(buf('32000000000000')) // no-op packet, should be ignored
        dut.processAABB(buf('323e0002000201')) // delta 0x0002, accum 0x0002, seq 1
        assert.equal(ha.devices[DEVICE_ID].properties['energy_consumption'], '2')
        // duplicate sequence should be deduplicated
        dut.processAABB(buf('323e0002000201'))
        assert.equal(ha.devices[DEVICE_ID].properties['energy_consumption'], '2')
        dut.processAABB(buf('323e0005000202')) // new sequence, accum unchanged
        assert.equal(ha.devices[DEVICE_ID].properties['energy_consumption'], '2')
    })

    test('generates CONTROL packets correctly (sendSettings)', () => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META as any)
        const dut = new DUT(ha as any, thinq as any, META)
        dut.start()

        // Configure cached settings first
        ;(dut as any).cachedRinseLevel = 0x02
        ;(dut as any).cachedSaltLevel = 0x03
        ;(dut as any).cachedAutoDry = true
        ;(dut as any).cachedCleanReminder = false
        ;(dut as any).cachedBuzzerLevel = 'HIGH'
        ;(dut as any).cachedRemoteStartMode = 'PERMANENT'
        ;(dut as any).cachedEndAlarmSound = false
        ;(dut as any).cachedBrightness = true

        dut.sendSettings()

        // 1st sent packet: f0 26 [Rinse 02] [Salt 03] [Opt1 24] [Opt2 80] [Opt3 40] 00 00 00
        // Opt1 = 0x20 (Auto Dry) + 0x04 (Buzzer HIGH) = 0x24
        // Opt2 = 0x80 (Remote PERMANENT)
        // Opt3 = 0x40 (Brightness)
        assert.equal(thinq.outbox.length, 1)
        assert.equal(thinq.outbox[0].toString('hex'), 'aa0ef0260203248040000000e2bb')
    })

    test('generates REMOTE START packet correctly', () => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META as any)
        const dut = new DUT(ha as any, thinq as any, META)
        dut.start()

        // Set target options
        dut.setProperty('target_course', 'One hour') // 0x12
        dut.setProperty('target_delay', '3')
        dut.setProperty('target_high_temp', 'ON') // 0x08
        dut.setProperty('target_extra_dry', 'ON') // 0x04
        dut.setProperty('target_extra_rinse', '1') // 0x08

        dut.setProperty('start_course', 'PRESS')

        // f0 26 10 [Course] [Delay] 00 [Opt3] [Opt4] 00
        // Opt3 = 0x08 + 0x04 = 0x0c
        // Opt4 = 0x08 (Rinse 1)
        const lastPayload = thinq.outbox[thinq.outbox.length - 1]
        assert.equal(lastPayload.toString('hex'), 'aa0df026101203000c080053bb')
    })

    test('power control commands', () => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META as any)
        const dut = new DUT(ha as any, thinq as any, META)
        dut.start()
        thinq.outbox.length = 0

        // Wake Up: inner F0 26 16 -> AA 07 F0 26 16 <cksum> BB
        // sum(0xAA+0x07+0xF0+0x26+0x16) = 0x143 -> 0x43^0x55 = 0x16
        dut.setProperty('power', 'ON')
        assert.equal(thinq.outbox[thinq.outbox.length - 1].toString('hex'), 'aa07f0261688bb')

        // Power Off: inner F0 26 12 -> sum = 0x1D9 -> 0xD9^0x55 = 0x8C
        dut.setProperty('power', 'OFF')
        assert.equal(thinq.outbox[thinq.outbox.length - 1].toString('hex'), 'aa07f026128cbb')
    })
})
