import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addCoffeeRoastAreaController,
  getCoffeeRoastAreasController,
  updateCoffeeRoastAreaController,
  deleteCoffeeRoastAreaController,
} from '../controllers/roasted-area.controller.js';

const coffeeRoastAreaRouter = Router();

coffeeRoastAreaRouter.post('/add', auth, addCoffeeRoastAreaController);
coffeeRoastAreaRouter.get('/get', getCoffeeRoastAreasController);
coffeeRoastAreaRouter.put('/update', auth, updateCoffeeRoastAreaController);
coffeeRoastAreaRouter.delete('/delete', auth, deleteCoffeeRoastAreaController);

export default coffeeRoastAreaRouter;
