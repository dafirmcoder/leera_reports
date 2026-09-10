// Verifies a homeroom teacher assigned to a subject in another class can work there.
import { demoApi } from '../src/lib/api.demo'

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key)
}

async function main() {
  localStorage.setItem('leera_demo_user', JSON.stringify({ id: 'homeroom@leera.school', email: 'homeroom@leera.school' }))
  const me = await demoApi.getProfile()
  const classes = await demoApi.listClasses()
  const db = JSON.parse(localStorage.getItem('leera_demo_db_v2')!)
  const y9 = db.classes.find((item: any) => item.id !== me?.class_id)
  const science = db.subjects.find((item: any) => item.name === 'Science')

  db.assignments.push({
    id: 'a_test', class_id: y9.id, class_name: y9.name,
    subject_id: science.id, subject_name: 'Science',
    teacher_id: me!.id, teacher_name: me!.full_name
  })
  localStorage.setItem('leera_demo_db_v2', JSON.stringify(db))

  const classes2 = await demoApi.listClasses()
  const assignments = await demoApi.listAssignments(y9.id)
  const tests = await demoApi.listUnitTests(y9.id)
  const id = await demoApi.createUnitTest(y9.id, {
    subject_id: science.id, title: 'Energy', test_date: '2026-09-10', max_mark: 40
  })
  const tests2 = await demoApi.listUnitTests(y9.id)

  const ok = classes.length === 1
    && classes2.length === 2
    && assignments.length === 1
    && assignments[0].subject_name === 'Science'
    && tests.every((test) => test.subject_name === 'Science')
    && Boolean(id)
    && tests2.some((test) => test.title === 'Energy')
  console.log(ok
    ? '\n✅ PASS - homeroom teacher can work in their assigned class'
    : '\n❌ FAIL - homeroom teacher regression')
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
