import type {
  CartDeliveryOptionsDiscountsGenerateRunResult,
  DeliveryInput,
} from "../generated/api";
import { buildDeliveryDiscountResult } from "./rules";

export function cartDeliveryOptionsDiscountsGenerateRun(
  input: DeliveryInput,
): CartDeliveryOptionsDiscountsGenerateRunResult {
  return buildDeliveryDiscountResult(input);
}
