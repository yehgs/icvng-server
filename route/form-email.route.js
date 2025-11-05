import {Router} from 'express'
import {formEmailController} from '../controllers/formEmail.controller.js'


const formEmailRouter = Router();

formEmailRouter.post('/', formEmailController)

export default formEmailRouter