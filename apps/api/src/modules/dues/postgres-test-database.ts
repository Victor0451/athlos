const cashDatabaseName = /^athlos_cash_[0-9a-f]{32}$/

type Admin = { query: (statement: string) => Promise<unknown> }

export async function disposableCashDatabase(admin: Admin, name: string) {
  if (!cashDatabaseName.test(name)) throw new Error('unsafe disposable database name')
  await admin.query(['CREATE DATABASE "', name, '"'].join(''))
}

export async function dropDisposableCashDatabase(admin: Admin, name: string) {
  if (!cashDatabaseName.test(name)) throw new Error('unsafe disposable database name')
  await admin.query(['DROP DATABASE IF EXISTS "', name, '"'].join(''))
}
