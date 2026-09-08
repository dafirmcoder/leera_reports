import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { ClassInfo, School, Subject } from '../lib/types'
import { useAuth } from './AuthContext'

interface SchoolState {
  school: School | null
  classes: ClassInfo[]
  subjects: Subject[]
  selectedClassId: string | null
  setSelectedClassId: (id: string) => void
  refresh: () => Promise<void>
}

const SchoolContext = createContext<SchoolState | null>(null)

export function SchoolProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [school, setSchool] = useState<School | null>(null)
  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)

  const refresh = async () => {
    const [s, c, sub] = await Promise.all([
      api.getSchool().catch(() => null),
      api.listClasses().catch(() => []),
      api.listSubjects().catch(() => [])
    ])
    setSchool(s)
    setClasses(c)
    setSubjects(sub)
    setSelectedClassId((prev) => (prev && c.some((x) => x.id === prev) ? prev : (c[0]?.id ?? null)))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role, profile?.additional_roles?.join(',')])

  return (
    <SchoolContext.Provider value={{ school, classes, subjects, selectedClassId, setSelectedClassId, refresh }}>
      {children}
    </SchoolContext.Provider>
  )
}

export function useSchool(): SchoolState {
  const ctx = useContext(SchoolContext)
  if (!ctx) throw new Error('useSchool must be used within SchoolProvider')
  return ctx
}
