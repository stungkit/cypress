import { defaultMessages } from '../locales/i18n'
import GlobalEmpty from './GlobalEmpty.vue'

const emptyText = defaultMessages.globalPage.empty

describe('<GlobalEmpty />', () => {
  it('renders the empty state', () => {
    cy.mount(() => (<div
      class="p-12 min-w-280px max-w-650px overflow-auto resize-x">
      <GlobalEmpty />
    </div>))

    cy.contains(emptyText.title)
    cy.contains(emptyText.helper)

    const parts = emptyText.dropText.split('{0}')

    cy.contains(parts[0])

    cy.contains(emptyText.browseManually)
  })
})
