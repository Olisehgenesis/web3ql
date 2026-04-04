'use client'

import { Plus, Trash2, Key } from 'lucide-react'
import type { SchemaField } from '@/lib/utils/schema'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FIELD_TYPES = [
  'TEXT', 'INT', 'BOOL', 'FLOAT', 'ADDRESS',
  'TIMESTAMP', 'DATE', 'UUID', 'BYTES32', 'JSON', 'ENUM', 'DECIMAL', 'BIGINT',
] as const

const TYPE_LABELS: Record<string, string> = {
  TEXT:      'TEXT — string',
  INT:       'INT — integer',
  BOOL:      'BOOL — boolean',
  FLOAT:     'FLOAT — decimal',
  ADDRESS:   'ADDRESS — wallet',
  TIMESTAMP: 'TIMESTAMP — datetime',
  DATE:      'DATE — date only',
  UUID:      'UUID — unique id',
  BYTES32:   'BYTES32 — hex data',
  JSON:      'JSON — object',
  ENUM:      'ENUM — choice list',
  DECIMAL:   'DECIMAL — precise num',
  BIGINT:    'BIGINT — large int',
}

// Extra inputs shown for specific types
function ExtraFieldInputs({
  field, idx, updateField, disabled,
}: { field: SchemaField; idx: number; updateField: (idx: number, patch: Partial<SchemaField>) => void; disabled?: boolean }) {
  if (field.type === 'ENUM') {
    return (
      <Input
        value={(field.enumValues ?? []).join(', ')}
        onChange={(e) => updateField(idx, { enumValues: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
        placeholder="Values: e.g. active, inactive, pending"
        disabled={disabled}
        className="h-7 text-[11px] mt-1 text-zinc-500"
      />
    )
  }
  if (field.type === 'DECIMAL') {
    const [p = 10, s = 2] = field.precision ?? []
    return (
      <div className="flex gap-1 mt-1">
        <Input
          type="number" min={1} max={38}
          value={p}
          onChange={(e) => updateField(idx, { precision: [Number(e.target.value), s] })}
          placeholder="Precision"
          disabled={disabled}
          className="h-7 text-[11px] w-20"
        />
        <Input
          type="number" min={0} max={18}
          value={s}
          onChange={(e) => updateField(idx, { precision: [p, Number(e.target.value)] })}
          placeholder="Scale"
          disabled={disabled}
          className="h-7 text-[11px] w-20"
        />
      </div>
    )
  }
  return null
}

interface SchemaBuilderProps {
  fields: SchemaField[]
  onChange: (fields: SchemaField[]) => void
  disabled?: boolean
}

export function SchemaBuilder({ fields, onChange, disabled }: SchemaBuilderProps) {
  const addField = () => {
    onChange([...fields, { name: '', type: 'TEXT' }])
  }

  const removeField = (idx: number) => {
    onChange(fields.filter((_, i) => i !== idx))
  }

  const updateField = (idx: number, patch: Partial<SchemaField>) => {
    onChange(fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex-1">Name</span>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-32">Type</span>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">PK</span>
        <span className="w-6" />
      </div>

      {/* Fields */}
      <div className="divide-y divide-gray-100">
        {fields.map((field, idx) => (
          <div key={idx} className="px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Input
                  value={field.name}
                  onChange={(e) => updateField(idx, { name: e.target.value })}
                  placeholder="field_name"
                  disabled={disabled}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="w-44">
                <Select
                  value={field.type}
                  onValueChange={(v) => updateField(idx, { type: v as SchemaField['type'] })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-[11px]">{TYPE_LABELS[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-8 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => updateField(idx, { primaryKey: !field.primaryKey })}
                  disabled={disabled}
                  className={cn(
                    'h-6 w-6 flex items-center justify-center rounded-md transition-colors',
                    field.primaryKey ? 'bg-violet-100 text-violet-600' : 'text-gray-300 hover:text-gray-500'
                  )}
                  title="Toggle primary key"
                >
                  <Key className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeField(idx)}
                disabled={disabled || fields.length <= 1}
                className="w-6 h-6 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 transition-colors disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <ExtraFieldInputs field={field} idx={idx} updateField={updateField} disabled={disabled} />
          </div>
        ))}
      </div>

      {/* Add field */}
      <div className="px-3 py-2 border-t border-gray-100">
        <button
          type="button"
          onClick={addField}
          disabled={disabled}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-violet-600 transition-colors disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add field
        </button>
      </div>
    </div>
  )
}
