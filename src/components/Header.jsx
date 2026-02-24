import React from 'react';
import styles from './Header.module.css';

export default function Header(){
  return (
    <header className={`${styles.header} container`}>
      <a className={styles.logo} href="#">DCPM Cloud</a>
      <nav className={styles.nav}>
        <a href="#">Dashboard</a>
        <a href="#">Assets</a>
        <a href="#">Reports</a>
        <a href="#">Settings</a>
      </nav>
    </header>
  );
}
