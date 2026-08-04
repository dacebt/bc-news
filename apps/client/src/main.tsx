import { ChakraProvider } from "@chakra-ui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditionPage } from "./pages/EditionPage";
import { theme } from "./theme";

const root = document.getElementById("root");
if (root === null) {
	throw new Error("Client HTML shell is missing its #root element");
}

createRoot(root).render(
	<StrictMode>
		<ChakraProvider theme={theme}>
			<EditionPage />
		</ChakraProvider>
	</StrictMode>,
);
