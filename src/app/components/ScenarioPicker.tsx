import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, Text } from 'react-aria-components'
import { mockInfo } from '../mockInfo'

/**
 * Mock mode's scenario picker, at the top of the settings popover (ADR-0005).
 * Choosing one reloads into it fresh: everything this device kept goes.
 * Rendered in mock builds only.
 */
export function ScenarioPicker() {
  const info = mockInfo()
  if (!info) return null
  return (
    <Select
      selectedKey={info.scenario}
      onSelectionChange={(key) => {
        if (import.meta.env.VITE_API === 'mock' && key !== null) {
          void import('virtual:compromised-mock').then((mock) => mock.switchScenario(String(key)))
        }
      }}
      className="grid min-w-0 gap-2 border-b border-rule pb-3"
    >
      <Label className="text-[18px] font-bold">Mock scenario</Label>
      <Button className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 text-left text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link">
        <SelectValue className="min-w-0 truncate">{({ selectedText }) => selectedText}</SelectValue>
        <span aria-hidden="true">▾</span>
      </Button>
      <Text slot="description" className="text-[12px] text-muted">
        Switching wipes this device’s data and reloads into the scenario.
      </Text>
      <Popover
        offset={4}
        className="max-h-[60vh] w-(--trigger-width) overflow-y-auto rounded-sm border-2 border-ink bg-paper text-ink shadow-[0_10px_30px_rgba(0,0,0,.18)] outline-none"
      >
        <ListBox items={info.scenarios} className="grid outline-none">
          {(scenario) => (
            <ListBoxItem
              id={scenario.name}
              textValue={scenario.name}
              className="grid cursor-pointer gap-0.5 px-3 py-2 outline-none data-focused:bg-ink data-focused:text-paper data-selected:font-bold"
            >
              <Text slot="label" className="text-[15px] font-bold">
                {scenario.name}
              </Text>
              <Text slot="description" className="text-[12px]">
                {scenario.summary}
              </Text>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  )
}
