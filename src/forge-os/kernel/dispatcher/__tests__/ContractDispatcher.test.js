import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createContractVersion,
} from "../../../contracts/v1/core/index.js";

import {
  createManagerRequestContract,
} from "../../../contracts/v1/requests/ManagerRequestContract.js";

import {
  ContractDispatcher,
} from "../ContractDispatcher.js";

import {
  ManagerRegistry,
} from "../../registry/ManagerRegistry.js";

function createRequest() {
  return createManagerRequestContract({
    contractId:
      "forge.request.test",
    version:
      createContractVersion({
        major:1,
        minor:0,
        patch:0,
      }),
    description:"Dispatcher test",
    provenance:{
      requestId:"r1",
      workflowId:"w1",
      correlationId:"c1",
      causationId:undefined,
      parentContractId:undefined,
      origin:{
        componentType:"kernel",
        componentId:"kernel",
      },
      contextVersion:"ctx",
      evidenceReferences:[],
    },
    targetWorkspace:"workspace",
    requestedCapability:
      "repository.inspect",
    input:{},
    grantedAuthority:{},
    securityScope:{},
    expectedOutput:{},
    validationExpectations:[],
    interruptionRules:{},
  });
}

describe(
  "ContractDispatcher",
  () => {

    it(
      "dispatches to the resolved manager",
      async () => {

        const registry =
          new ManagerRegistry();

        const outcome = {
          metadata:{
            contractType:
              "outcome",
          },
        };

        const execute =
          vi.fn()
            .mockResolvedValue(
              outcome,
            );

        registry.register({
          managerIdentity:
            "repository-manager",
          capabilities:[
            "repository.inspect",
          ],
          execute,
        });

        const dispatcher =
          new ContractDispatcher({
            managerRegistry:
              registry,
          });

        const request =
          createRequest();

        const result =
          await dispatcher.dispatch(
            request,
          );

        expect(result)
          .toBe(outcome);

        expect(execute)
          .toHaveBeenCalledWith(
            request,
          );
      },
    );

    it(
      "rejects structurally invalid contracts",
      async () => {

        const dispatcher =
          new ContractDispatcher({
            managerRegistry:
              new ManagerRegistry(),
          });

        await expect(
          dispatcher.dispatch({})
        ).rejects.toThrow(
          "Request contract failed structural validation.",
        );
      },
    );

    it(
      "requires a manager registry",
      () => {

        expect(
          () =>
            new ContractDispatcher(
              {},
            ),
        ).toThrow(
          "ContractDispatcher requires a managerRegistry.",
        );
      },
    );

    it(
      "propagates unknown capability failures",
      async () => {

        const dispatcher =
          new ContractDispatcher({
            managerRegistry:
              new ManagerRegistry(),
          });

        await expect(
          dispatcher.dispatch(
            createRequest(),
          ),
        ).rejects.toThrow(
          "Unknown manager capability: repository.inspect",
        );
      },
    );

  },
);
