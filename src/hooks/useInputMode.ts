import {createContext, useContext} from 'react';

interface InputModeContextValue {
  inputActive: boolean;
  setInputActive: (active: boolean) => void;
}

export const InputModeContext = createContext<InputModeContextValue>({
  inputActive: false,
  setInputActive: () => {},
});

export function useInputMode() {
  return useContext(InputModeContext);
}
