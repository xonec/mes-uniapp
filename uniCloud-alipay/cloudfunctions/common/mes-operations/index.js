'use strict'
const scope = require('./scope')
const claims = require('./personnel-claims')
const calendar = require('./calendar')
const handlers = { ...require('./catalogs'), ...require('./schedules'), ...require('./personnel-import'), ...require('./jobs'), ...require('./handovers'), ...require('./reports'), ...require('./attendance'), ...claims, ...calendar, bootstrap: scope.bootstrap }
const UNBOUND_ACTIONS = ['claimCandidates', 'requestPersonnelClaim', 'myPersonnelClaim']
const ACTIONS = ['scheduleCalendar','saveAttendance','resolveAttendanceConflict','attendanceSummary','syncAttendance','myAttendance','attendanceHistory','listAttendance','prepareScheduleImport','finishScheduleImport','scheduleImportScope','listPersonnelClaims','reviewPersonnelClaim','bootstrap','saveCatalog','listSchedules','saveSchedule','importSchedules','listJobs','createJob','getJob','jobCommand','listHandovers','getHandover','saveHandover','handoverCommand','listExceptions','saveException','resolveException','dashboard','report','trace','audit']
/** 已登录但未绑定的用户仅可申请认领，其他操作必须重新核对实际人员及权限。 */
async function execute(db, auth, input) {
    if (input.action === 'confirmAttendance') throw new (require('mes-common').ClientError)('考勤已改为直接记录，请更新小程序', 409)
    if (UNBOUND_ACTIONS.includes(input.action)) return handlers[input.action](db, auth, input)
    if (!ACTIONS.includes(input.action)) throw new (require('mes-common').ClientError)('操作不存在', 400)
    return handlers[input.action](db, await scope.profile(db, auth), input)
}
module.exports = { execute }
