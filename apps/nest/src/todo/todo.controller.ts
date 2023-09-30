import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete
} from '@nestjs/common'
import { TodoService } from './todo.service'
import { Todo } from '@usemotionvalue/types'

@Controller('todo')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Post()
  create(@Body() createTodoDto: Todo) {
    return this.todoService.create(createTodoDto)
  }

  @Get()
  findAll() {
    return this.todoService.findAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.todoService.findOne(+id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTodoDto: Todo) {
    return this.todoService.update(+id, updateTodoDto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.todoService.remove(+id)
  }
}
