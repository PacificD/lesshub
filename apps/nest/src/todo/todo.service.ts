import { Injectable } from '@nestjs/common'
import { Todo } from '@usemotionvalue/types'
import { shuffle } from '@usemotionvalue/utils'

@Injectable()
export class TodoService {
  create(createTodoDto: Todo) {
    return 'This action adds a new todo'
  }

  findAll() {
    return `This action returns all todo`
  }

  findOne(id: number) {
    const shuffledArray = shuffle<number>(
      Array.from({ length: 10 }, (_, i) => i + 1)
    )
    return {
      id,
      shuffledArray
    }
  }

  update(id: number, updateTodoDto: Todo) {
    return `This action updates a #${id} todo`
  }

  remove(id: number) {
    return `This action removes a #${id} todo`
  }
}
