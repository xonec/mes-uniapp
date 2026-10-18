'use strict'
const { ClientError } = require('mes-common')

/** 班次以排班生产日为基准，次日零点不能混作当日零点。兼容旧班次的跨日时间。 */
function shiftPeriod(source, defaults = {}) {
    const startTime = source.startTime || defaults.startTime
    const endTime = source.endTime || defaults.endTime
    const startDayOffset = offset(source.startDayOffset, defaults.startDayOffset == null ? 0 : defaults.startDayOffset)
    const endDayOffset = offset(source.endDayOffset, defaults.endDayOffset == null ? startDayOffset + (endTime <= startTime ? 1 : 0) : defaults.endDayOffset)
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    if (![startTime, endTime].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || ''))) throw new ClientError('班次时间须为 HH:mm 格式', 400)
    const duration = endDayOffset * 1440 + minutes(endTime) - startDayOffset * 1440 - minutes(startTime)
    if (duration <= 0 || duration > 1440) throw new ClientError('实际排班时长须大于 0 且不超过 24 小时，请核对当天／次日', 400)
    return { startTime, endTime, startDayOffset, endDayOffset, plannedHours: duration / 60, crossDay: endDayOffset > startDayOffset }
}
function offset(value, fallback) {
    const result = value == null || value === '' ? Number(fallback) : Number(value)
    if (!Number.isInteger(result) || result < 0 || result > 1) throw new ClientError('班次日期须选择当天或次日', 400)
    return result
}
module.exports = { shiftPeriod }
