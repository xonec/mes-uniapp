// 云函数测试用内存数据库：支持本项目实际使用的筛选、分页、原子更新与固定主键。
const clone = value => JSON.parse(JSON.stringify(value))

function createMemoryDb() {
    const store = new Map()
    const command = Object.fromEntries(['lt', 'lte', 'gte', 'neq', 'exists', 'inc'].map(op => [op, value => ({ op, value })]))
    command.or = (...items) => ({ op: 'or', value: items.flat() })
    command.and = (...items) => ({ op: 'and', value: items.flat() })
    const ensure = name => {
        if (!store.has(name)) store.set(name, new Map())
        return store.get(name)
    }
    const match = (doc, where) => {
        if (!where) return true
        if (where.op === 'or') return where.value.some(item => match(doc, item))
        if (where.op === 'and') return where.value.every(item => match(doc, item))
        return Object.entries(where).every(([key, value]) => {
            if (value instanceof RegExp) return value.test(String(doc[key] || ''))
            if (value && value.op === 'lt') return doc[key] < value.value
            if (value && value.op === 'lte') return doc[key] <= value.value
            if (value && value.op === 'gte') return doc[key] >= value.value
            if (value && value.op === 'neq') return doc[key] !== value.value
            if (value && value.op === 'exists') return (doc[key] !== undefined) === value.value
            return doc[key] === value
        })
    }
    const apply = (old, data) => Object.assign({}, old, Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
        value && value.op === 'inc' ? (Number(old[key]) || 0) + value.value : clone(value)
    ])))
    const db = {
        command,
        RegExp: ({ regexp, options }) => new RegExp(regexp, options),
        store, ensure,
        failWrite: null,
        collection(name) {
            const query = where => {
                let limit = Infinity, skip = 0, order = [], fields = null
                const all = () => [...ensure(name).values()].filter(doc => match(doc, where))
                const q = {
                    where: value => query(value),
                    limit(value) { limit = value; return q },
                    skip(value) { skip = value; return q },
                    orderBy(key, direction) { order.push([key, direction]); return q },
                    field(value) { fields = value; return q },
                    async count() { return { total: all().length } },
                    async get() {
                        const rows = all().sort((a, b) => {
                            for (const [key, direction] of order) {
                                const cmp = a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0
                                if (cmp) return direction === 'desc' ? -cmp : cmp
                            }
                            return 0
                        }).slice(skip, skip + limit).map(clone)
                        return { data: fields ? rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key === '_id' || fields[key]))) : rows }
                    },
                    async update(data) {
                        if (db.failWrite === name) throw new Error('write failed')
                        let updated = 0
                        for (const [id, old] of ensure(name)) {
                            if (match(old, where)) { ensure(name).set(id, apply(old, data)); updated++ }
                        }
                        return { updated }
                    },
                    async add(data) {
                        if (db.failWrite === name) throw new Error('write failed')
                        const id = data._id
                        if (ensure(name).has(id)) throw new Error('duplicate key')
                        ensure(name).set(id, clone(data))
                        return { id }
                    },
                    doc(id) {
                        return {
                            field(value) { return query({ _id: id }).field(value) },
                            async get() { const doc = ensure(name).get(id); return { data: doc ? [clone(doc)] : [] } },
                            async set(data) {
                                if (db.failWrite === name) throw new Error('write failed')
                                ensure(name).set(id, { ...clone(data), _id: id }); return { updated: 1 }
                            },
                            update: data => query({ _id: id }).update(data)
                        }
                    }
                }
                return q
            }
            return query(null)
        }
    }
    return db
}
module.exports = { createMemoryDb }
