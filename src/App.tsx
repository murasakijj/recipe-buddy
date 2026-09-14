import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { RecipesProvider } from "./contexts/RecipesProvider";
import { TechniquesProvider } from "./contexts/TechniquesProvider";
import RequireAuth from "./components/RequireAuth";
import Login from "./pages/Login";
import RecipeList from "./pages/RecipeList";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeEdit from "./pages/RecipeEdit";
import TechniqueList from "./pages/TechniqueList";
import TechniqueEdit from "./pages/TechniqueEdit";
import CookMode from "./pages/CookMode";
import ArrangeInput from "./pages/ArrangeInput";
import ArrangeResult from "./pages/ArrangeResult";

function ProtectedLayout() {
  return (
    <RequireAuth>
      <RecipesProvider>
        <TechniquesProvider>
          <Outlet />
        </TechniquesProvider>
      </RecipesProvider>
    </RequireAuth>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<RecipeList />} />
            <Route path="/recipes/new" element={<RecipeEdit />} />
            <Route path="/recipes/:id" element={<RecipeDetail />} />
            <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
            <Route
              path="/recipes/:id/cook"
              element={<CookMode temporary={false} />}
            />
            <Route path="/recipes/:id/arrange" element={<ArrangeInput />} />
            <Route
              path="/recipes/:id/arrange/result"
              element={<ArrangeResult />}
            />
            <Route
              path="/recipes/:id/arrange/cook"
              element={<CookMode temporary={true} />}
            />
            <Route path="/techniques" element={<TechniqueList />} />
            <Route path="/techniques/new" element={<TechniqueEdit />} />
            <Route path="/techniques/:id/edit" element={<TechniqueEdit />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
