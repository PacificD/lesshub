import { text, boolean, pgTable } from 'drizzle-orm/pg-core'

export const todo = pgTable('todo', {
  id: text('id').notNull().primaryKey(),
  text: text('text').notNull(),
  done: boolean('done').default(false).notNull()
})
