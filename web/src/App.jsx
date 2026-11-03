import { Navigate, Route, Routes } from 'react-router-dom';
import { getSession } from './api.js';
import Login from './pages/Login.jsx';
import ResidentShell from './pages/resident/Shell.jsx';
import Home from './pages/resident/Home.jsx';
import Bills from './pages/resident/Bills.jsx';
import Receipt from './pages/resident/Receipt.jsx';
import Complaints from './pages/resident/Complaints.jsx';
import ComplaintNew from './pages/resident/ComplaintNew.jsx';
import ComplaintDetail from './pages/resident/ComplaintDetail.jsx';
import Visitors from './pages/resident/Visitors.jsx';
import Profile from './pages/resident/Profile.jsx';
import Book from './pages/resident/Book.jsx';
import DeskShell from './pages/desk/Shell.jsx';
import Queue from './pages/desk/Queue.jsx';
import Matching from './pages/desk/Matching.jsx';
import Flats from './pages/desk/Flats.jsx';
import Report from './pages/desk/Report.jsx';
import Approvals from './pages/desk/Approvals.jsx';
import Admin from './pages/desk/Admin.jsx';
import Residents from './pages/desk/Residents.jsx';
import Gate from './pages/gate/Gate.jsx';
import GateNotice from './pages/GateNotice.jsx';
import ImportRegister from './pages/desk/ImportRegister.jsx';
import TallyExport from './pages/desk/TallyExport.jsx';
import Bookings from './pages/desk/Bookings.jsx';

export const homeFor = (role) => ({ resident: '/', helpdesk: '/desk', accounts: '/desk/matching', committee: '/desk/report', admin: '/desk', guard: '/gate' }[role] || '/login');

function Guard({ roles, children }) {
  const s = getSession();
  if (!s) return <Navigate to="/login" replace />;
  if (!roles.includes(s.user.role)) return <Navigate to={homeFor(s.user.role)} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Guard roles={['resident']}><ResidentShell /></Guard>}>
        <Route index element={<Home />} />
        <Route path="bills" element={<Bills />} />
        <Route path="receipts/:id" element={<Receipt />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="complaints/new" element={<ComplaintNew />} />
        <Route path="complaints/:id" element={<ComplaintDetail />} />
        <Route path="visitors" element={<Visitors />} />
        <Route path="me" element={<Profile />} />
        <Route path="book" element={<Book />} />
      </Route>
      <Route path="/desk" element={<Guard roles={['helpdesk', 'accounts', 'committee', 'admin']}><DeskShell /></Guard>}>
        <Route index element={<Queue />} />
        <Route path="matching" element={<Matching />} />
        <Route path="flats" element={<Flats />} />
        <Route path="flats/:id" element={<Flats />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="report" element={<Report />} />
        <Route path="admin" element={<Admin />} />
        <Route path="residents" element={<Residents />} />
        <Route path="import" element={<ImportRegister />} />
        <Route path="tally" element={<TallyExport />} />
        <Route path="bookings" element={<Bookings />} />
      </Route>
      <Route path="/gate" element={<Gate />} />
      <Route path="/gate-notice" element={<GateNotice />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
